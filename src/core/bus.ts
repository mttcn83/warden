import { EventEmitter } from 'node:events';

/** What Raid protection hands to Admin guard once a raid is over. */
export interface RaidReport {
  guildId: string;
  startedAt: number;
  endedAt: number;
  memberIds: string[]; // every account treated as part of the raid
  botIds: string[]; // the bots among them
  inviterIds: string[]; // owners of the invites the raiders used
  inviterCounts?: Record<string, number>; // how many raiders came in through each of them
}
export const bus = new EventEmitter();
export const emitRaidEnded = (r: RaidReport) => bus.emit('raidEnded', r);
export const onRaidEnded = (fn: (r: RaidReport) => void) => bus.on('raidEnded', fn);
export const emitRaidProgress = (r: RaidReport) => bus.emit('raidProgress', r);
export const onRaidProgress = (fn: (r: RaidReport) => void) => bus.on('raidProgress', fn);
