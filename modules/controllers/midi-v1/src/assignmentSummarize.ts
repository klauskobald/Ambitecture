import { AssignmentRecord, GraphReplica } from './GraphReplica';
import { ReceiverNoteAndControl } from './receivers/ReceiverNoteAndControl';
import { ReceiverNoteOnOff } from './receivers/ReceiverNoteOnOff';

export function summarizeAssignmentForPlugin(a: AssignmentRecord, graph: GraphReplica): string {
  const intentName = (guid: string) => graph.getIntentName(guid);
  const line =
    ReceiverNoteAndControl.formatPluginListLine(a, intentName) ??
    ReceiverNoteOnOff.formatPluginListLine(a, intentName);
  if (line !== null) return line;
  return a.class;
}
