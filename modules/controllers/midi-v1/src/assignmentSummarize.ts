import { AssignmentRecord, GraphReplica } from './GraphReplica';
import { ReceiverControl } from './receivers/ReceiverControl';
import { ReceiverControlToggle } from './receivers/ReceiverControlToggle';
import { ReceiverNoteAndControl } from './receivers/ReceiverNoteAndControl';
import { ReceiverNoteOnOff } from './receivers/ReceiverNoteOnOff';
import { ReceiverNoteOnOffToggle } from './receivers/ReceiverNoteOnOffToggle';

export function summarizeAssignmentForPlugin(a: AssignmentRecord, graph: GraphReplica): string {
  const resolveName = (guid: string) => graph.getIntentName(guid) ?? graph.getActionName(guid);
  const resolveExecuteType = (guid: string) => graph.getActionExecuteType(guid);
  const line =
    ReceiverControl.formatPluginListLine(a, resolveName, resolveExecuteType) ??
    ReceiverControlToggle.formatPluginListLine(a, resolveName, resolveExecuteType) ??
    ReceiverNoteAndControl.formatPluginListLine(a, resolveName, resolveExecuteType) ??
    ReceiverNoteOnOff.formatPluginListLine(a, resolveName, resolveExecuteType) ??
    ReceiverNoteOnOffToggle.formatPluginListLine(a, resolveName, resolveExecuteType);
  if (line !== null) return line;
  return a.class;
}
