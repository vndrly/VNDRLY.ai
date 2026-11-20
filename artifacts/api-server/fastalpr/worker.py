"""Resident CPU recognizer. Standard output is exclusively the JSON protocol."""
import base64
import contextlib
import json
import sys
import time

with contextlib.redirect_stdout(sys.stderr):
    import cv2
    import numpy as np
    from fast_alpr import ALPR
    model = ALPR(detector_model="yolo-v9-t-640-license-plate-end2end",
                 ocr_model="cct-xs-v2-global-model")

print(json.dumps({"ready": True}), flush=True)
for line in sys.stdin:
    request = {}
    try:
        request = json.loads(line)
        started = time.perf_counter()
        raw = base64.b64decode(request["imageBase64"], validate=True)
        if not 32 <= len(raw) <= 8 * 1024 * 1024:
            raise ValueError("Invalid image size")
        image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None or image.shape[0] * image.shape[1] > 20_000_000:
            raise ValueError("Invalid image dimensions")
        with contextlib.redirect_stdout(sys.stderr):
            predictions = model.predict(image)
        plates = [p.ocr for p in predictions if p.ocr and p.ocr.text]
        result = plates[0] if len(plates) == 1 else None
        confidence = result.confidence if result else None
        if isinstance(confidence, (list, tuple)):
            confidence = min(confidence) if confidence else None
        print(json.dumps({"id": request["id"], "result": {
            "plate": result.text.upper() if result else None,
            # FastALPR's region is a country, not a US issuing state.
            "state": None, "stateConfidence": None,
            "plateConfidence": float(confidence) if confidence is not None else None,
            "quality": "multiple_vehicles" if len(plates) > 1 else "readable" if result else "unreadable",
            "provider": "fastalpr", "modelVersion": "yolo-v9-t-640/cct-xs-v2",
            "elapsedMs": round((time.perf_counter() - started) * 1000),
            "reviewRequired": True
        }}), flush=True)
    except Exception:
        print(json.dumps({"id": request.get("id"), "error": "Plate photo could not be read"}), flush=True)
