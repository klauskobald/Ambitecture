import { AssignmentRecord, GraphReplica } from './GraphReplica';
import { ReceiverControl } from './receivers/ReceiverControl';
import { ReceiverNoteAndControl } from './receivers/ReceiverNoteAndControl';
import { ReceiverNoteOnOff } from './receivers/ReceiverNoteOnOff';
import { ReceiverNoteOnOffToggle } from './receivers/ReceiverNoteOnOffToggle';

export function summarizeAssignmentForPlugin(a: AssignmentRecord, graph: GraphReplica): string {
  const intentName = (guid: string) => graph.getIntentName(guid);
  const line =
    ReceiverControl.formatPluginListLine(a, intentName) ??
    ReceiverNoteAndControl.formatPluginListLine(a, intentName) ??
    ReceiverNoteOnOff.formatPluginListLine(a, intentName) ??
    ReceiverNoteOnOffToggle.formatPluginListLine(a, intentName);
  if (line !== null) return line;
  return a.class;
}
