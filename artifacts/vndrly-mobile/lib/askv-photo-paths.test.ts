import {expect,it} from "vitest";
import {askVPhotoPaths} from "./askv-photo-paths";
it("restores unique uploaded image references from a saved conversation",()=>expect(askVPhotoPaths("[Photo](/objects/uploads/a-b) [Photo](/objects/uploads/a-b)")).toEqual(["/objects/uploads/a-b"]));
it("does not turn arbitrary external URLs or traversal into authenticated images",()=>expect(askVPhotoPaths("[Photo](https://elsewhere.test/a) [Photo](/objects/../secret) [Photo](/objects/%2e%2e/secret)")).toEqual([]));
