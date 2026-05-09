import { AssignmentRecord, GraphReplica } from './GraphReplica';
import { ReceiverNoteAndControl } from './receivers/ReceiverNoteAndControl';

export function summarizeAssignmentForPlugin(a: AssignmentRecord, graph: GraphReplica): string {
  const line = ReceiverNoteAndControl.formatPluginListLine(a, guid => graph.getIntentName(guid));
  if (line !== null) return line;
  return a.class;
}
