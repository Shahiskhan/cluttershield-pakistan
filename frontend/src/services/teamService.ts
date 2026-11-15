import type { TeamMessage, TeamRoom } from "../types";
import { invokeFunction } from "./functionClient";

export function getTeamRooms() {
  return invokeFunction<TeamRoom[]>("team-chat", { action: "rooms" });
}

export function postTeamMessage(teamId: string, body: string) {
  return invokeFunction<TeamMessage>("team-chat", { action: "send", teamId, body });
}
