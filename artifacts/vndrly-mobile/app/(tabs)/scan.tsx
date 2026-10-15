import { Redirect } from "expo-router";
/** Old job-scanning links now return to assigned work. */
export default function RetiredJobScanScreen() { return <Redirect href="/work-hub/my-work" />; }
