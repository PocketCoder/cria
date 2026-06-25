import type { FilterNode, FilterValue, FilterOperator, FilterClause } from './filterQueryParser';
import type { SortRule } from './sortEngine';
import { sortRuleToOrderBy } from './sortEngine';

export interface CompiledFilter {
  where: string;
  params: unknown[];
}

const FIELD_TO_COLUMN: Record<string, string> = {
  done: 't.done',
  priority: 't.priority',
  percentDone: 't.percent_done',
  dueDate: 't.due_date',
  startDate: 't.start_date',
  endDate: 't.end_date',
  doneAt: 't.done_at',
  created: 't.created_at',
  updated: 't.updated_at',
};

export function compileFilter(
  ast: FilterNode | null,
  includeNulls: boolean,
): CompiledFilter {
  if (!ast) return { where: '', params: [] };

  const clauses: string[] = [];
  const params: unknown[] = [];

  compileNode(ast, clauses, params, includeNulls);

  return { where: clauses.join(' AND '), params };
}

function compileNode(
  node: FilterNode,
  clauses: string[],
  params: unknown[],
  includeNulls: boolean,
): void {
  if (node.type === 'group') {
    const groupClauses: string[] = [];
    const groupParams: unknown[] = [];

    for (const child of node.children) {
      const childClauses: string[] = [];
      const childParams: unknown[] = [];
      compileNode(child, childClauses, childParams, includeNulls);
      groupClauses.push(childClauses.join(' AND '));
      groupParams.push(...childParams);
    }

    const joined = groupClauses.filter(Boolean);
    if (joined.length === 0) return;

    const expr = joined.length === 1
      ? joined[0]!
      : `(${joined.join(` ${node.operator === '||' ? 'OR' : 'AND'} `)})`;

    clauses.push(expr);
    params.push(...groupParams);
  } else {
    compileClause(node, clauses, params, includeNulls);
  }
}

function compileClause(
  clause: FilterClause,
  clauses: string[],
  params: unknown[],
  includeNulls: boolean,
): void {
  const col = FIELD_TO_COLUMN[clause.field];

  if (col) {
    compileScalarClause(clause, col, clauses, params, includeNulls);
    return;
  }

  if (clause.field === 'reminders') {
    compileRemindersClause(clause, clauses, params);
    return;
  }

  if (clause.field === 'assignees') {
    compileAssigneesClause(clause, clauses, params);
    return;
  }

  if (clause.field === 'labels') {
    compileLabelsClause(clause, clauses, params);
    return;
  }

  if (clause.field === 'project') {
    compileProjectClause(clause, clauses, params);
    return;
  }

  throw new Error(`Unknown filter field: ${clause.field}`);
}

function compileScalarClause(
  clause: FilterNode & { type: 'clause' },
  col: string,
  clauses: string[],
  params: unknown[],
  includeNulls: boolean,
): void {
  const sqlOp = operatorToSql(clause.operator);
  const values = clause.value.type === 'array' ? clause.value.values : [clause.value];
  const sqlValues = values.map((v) => filterValueToSql(v));

  if (clause.operator === 'in' || clause.operator === 'not in') {
    const placeholders = sqlValues.map(() => '?').join(', ');
    const nullCheck = includeNulls
      ? `(${col} IS NULL OR ${col} ${sqlOp} (${placeholders}))`
      : `${col} ${sqlOp} (${placeholders})`;
    clauses.push(nullCheck);
    params.push(...sqlValues);
    return;
  }

  if (sqlValues.length !== 1) return;

  const sv = sqlValues[0];
  let sql: string;

  if (sv === null) {
    if (clause.operator === '=') sql = `${col} IS NULL`;
    else if (clause.operator === '!=') sql = `${col} IS NOT NULL`;
    else sql = `${col} IS NULL`;
  } else if (typeof sv === 'string' && clause.operator === 'like') {
    sql = `${col} LIKE ?`;
  } else {
    sql = `${col} ${sqlOp} ?`;
  }

  if (includeNulls && clause.operator !== '=' && clause.operator !== '!=') {
    clauses.push(`(${col} IS NULL OR ${sql})`);
  } else {
    clauses.push(sql);
  }

  if (sv !== null) params.push(sv);
}

function compileRemindersClause(
  clause: FilterClause,
  clauses: string[],
  params: unknown[],
): void {
  const sqlOp = operatorToSql(clause.operator);
  const values = clause.value.type === 'array' ? clause.value.values : [clause.value];
  const sqlValues = values.map((v) => filterValueToSql(v));

  if (clause.operator === 'in' || clause.operator === 'not in') {
    const placeholders = sqlValues.map(() => '?').join(', ');
    clauses.push(
      `EXISTS (SELECT 1 FROM task_reminders tr WHERE tr.task_local_id = t.local_id AND tr.reminder ${sqlOp} (${placeholders}))`
    );
    params.push(...sqlValues);
    return;
  }

  if (sqlValues.length < 1 || sqlValues[0] === null) return;
  clauses.push(
    `EXISTS (SELECT 1 FROM task_reminders tr WHERE tr.task_local_id = t.local_id AND tr.reminder ${sqlOp} ?)`
  );
  params.push(sqlValues[0]);
}

function compileAssigneesClause(
  clause: FilterClause,
  clauses: string[],
  params: unknown[],
): void {
  const values = clause.value.type === 'array' ? clause.value.values : [clause.value];
  const sqlValues = values.map((v) => filterValueToSql(v));

  if (clause.operator === 'in') {
    const placeholders = sqlValues.map(() => '?').join(', ');
    clauses.push(
      `EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_local_id = t.local_id AND ta.username IN (${placeholders}))`
    );
    params.push(...sqlValues);
  } else if (clause.operator === 'not in') {
    const placeholders = sqlValues.map(() => '?').join(', ');
    clauses.push(
      `NOT EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_local_id = t.local_id AND ta.username IN (${placeholders}))`
    );
    params.push(...sqlValues);
  } else if (clause.operator === '=') {
    if (sqlValues.length < 1 || sqlValues[0] === null) return;
    clauses.push(
      `EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_local_id = t.local_id AND ta.username = ?)`
    );
    params.push(sqlValues[0]);
  } else if (clause.operator === '!=') {
    if (sqlValues.length < 1 || sqlValues[0] === null) return;
    clauses.push(
      `NOT EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_local_id = t.local_id AND ta.username = ?)`
    );
    params.push(sqlValues[0]);
  }
}

function compileLabelsClause(
  clause: FilterClause,
  clauses: string[],
  params: unknown[],
): void {
  const values = clause.value.type === 'array' ? clause.value.values : [clause.value];
  const sqlValues = values.map((v) => filterValueToSql(v));

  if (clause.operator === 'in') {
    const placeholders = sqlValues.map(() => '?').join(', ');
    clauses.push(
      `EXISTS (SELECT 1 FROM task_labels tl JOIN labels l ON l.local_id = tl.label_local_id WHERE tl.task_local_id = t.local_id AND l.title IN (${placeholders}))`
    );
    params.push(...sqlValues);
  } else if (clause.operator === 'not in') {
    const placeholders = sqlValues.map(() => '?').join(', ');
    clauses.push(
      `NOT EXISTS (SELECT 1 FROM task_labels tl JOIN labels l ON l.local_id = tl.label_local_id WHERE tl.task_local_id = t.local_id AND l.title IN (${placeholders}))`
    );
    params.push(...sqlValues);
  } else if (clause.operator === '=') {
    if (sqlValues.length < 1 || sqlValues[0] === null) return;
    clauses.push(
      `EXISTS (SELECT 1 FROM task_labels tl JOIN labels l ON l.local_id = tl.label_local_id WHERE tl.task_local_id = t.local_id AND l.title = ?)`
    );
    params.push(sqlValues[0]);
  } else if (clause.operator === '!=') {
    if (sqlValues.length < 1 || sqlValues[0] === null) return;
    clauses.push(
      `NOT EXISTS (SELECT 1 FROM task_labels tl JOIN labels l ON l.local_id = tl.label_local_id WHERE tl.task_local_id = t.local_id AND l.title = ?)`
    );
    params.push(sqlValues[0]);
  }
}

function compileProjectClause(
  clause: FilterClause,
  clauses: string[],
  params: unknown[],
): void {
  const values = clause.value.type === 'array' ? clause.value.values : [clause.value];
  const sqlValues = values.map((v) => filterValueToSql(v));

  if (clause.operator === 'in') {
    const placeholders = sqlValues.map(() => '?').join(', ');
    clauses.push(
      `EXISTS (SELECT 1 FROM projects p2 WHERE p2.local_id = t.project_local_id AND p2.title IN (${placeholders}))`
    );
    params.push(...sqlValues);
  } else if (clause.operator === 'not in') {
    const placeholders = sqlValues.map(() => '?').join(', ');
    clauses.push(
      `NOT EXISTS (SELECT 1 FROM projects p2 WHERE p2.local_id = t.project_local_id AND p2.title IN (${placeholders}))`
    );
    params.push(...sqlValues);
  } else if (clause.operator === '=') {
    if (sqlValues.length < 1 || sqlValues[0] === null) return;
    clauses.push(
      `EXISTS (SELECT 1 FROM projects p2 WHERE p2.local_id = t.project_local_id AND p2.title = ?)`
    );
    params.push(sqlValues[0]);
  } else if (clause.operator === '!=') {
    if (sqlValues.length < 1 || sqlValues[0] === null) return;
    clauses.push(
      `NOT EXISTS (SELECT 1 FROM projects p2 WHERE p2.local_id = t.project_local_id AND p2.title = ?)`
    );
    params.push(sqlValues[0]);
  }
}

function operatorToSql(op: FilterOperator): string {
  switch (op) {
    case '=': return '=';
    case '!=': return '!=';
    case '>': return '>';
    case '>=': return '>=';
    case '<': return '<';
    case '<=': return '<=';
    case 'like': return 'LIKE';
    case 'in': return 'IN';
    case 'not in': return 'NOT IN';
  }
}

function filterValueToSql(value: FilterValue): unknown {
  switch (value.type) {
    case 'number': return value.value;
    case 'boolean': return value.value ? 1 : 0;
    case 'string': return value.value;
    case 'dateMath': return value.resolved;
    case 'array': return value.values.map((v: FilterValue) => filterValueToSql(v));
  }
}

export function compileFilterAndSort(
  ast: FilterNode | null,
  includeNulls: boolean,
  sortRule: SortRule | null,
): { where: string; params: unknown[]; orderBy: string } {
  const { where, params } = compileFilter(ast, includeNulls);
  const orderBy = sortRuleToOrderBy(sortRule);
  return { where, params, orderBy };
}
