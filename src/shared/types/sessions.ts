/** Row of the `sessions` table (one Pi session per employee per chat). */
export interface EmployeeSession {
  employeeId: number;
  chatId: number;
  session: string;
}

export interface AgentSessionContext {
  employeeId: number;
  chatId: number;
}
