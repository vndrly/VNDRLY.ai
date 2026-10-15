import { Redirect } from "expo-router";

/** Compatibility route for old Comms links; Work Hub owns communications. */
export default function RetiredCommsScreen() {
  return <Redirect href="/work-hub/chat" />;
}
