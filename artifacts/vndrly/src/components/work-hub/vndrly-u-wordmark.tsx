/** Keep the supplied wordmark inside the existing title's line box. */
export function VndrlyUWordmark() {
  return (
    <span className="relative inline-block align-[-0.1em]" style={{ width: "7.1em", maxWidth: "100%", height: "1em" }}>
      <img
        src={`${import.meta.env.BASE_URL}images/vndrly-u-wordmark.png`}
        alt="VNDRLY/U"
        className="absolute inset-0 h-full w-full object-cover"
      />
    </span>
  );
}
