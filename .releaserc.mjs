import { buildReleaseConfig, currentMajorFromRepo } from "./scripts/release-rules.mjs";

export default buildReleaseConfig(currentMajorFromRepo());
