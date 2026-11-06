import { createContext, useContext } from "react";

/** Allows data reveals to wait until their containing page card is visible. */
export const RagEntranceReadyContext = createContext(true);

export function useRagEntranceReady() {
  return useContext(RagEntranceReadyContext);
}
