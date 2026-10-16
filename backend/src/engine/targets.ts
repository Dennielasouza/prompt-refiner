// Target resolution lives in /shared so the extension can label the auto-detected target;
// the backend remains the authority for the target actually used.
export { HOST_TARGETS, resolveTarget, targetFromHostname } from "../../../shared/hostTargets.js";
