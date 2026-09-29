/** Row of the `sessions` table (one Pi session per employee per chat). */
export interface EmployeeSession {
  employeeId: number;
  chatId: number;
  session: string;
  /** Per-(employee, chat) read cursor: the highest message id the agent has read. */
  lastReadMessageId: number;
}

export interface AgentSessionContext {
  employeeId: number;
  chatId: number;
}
