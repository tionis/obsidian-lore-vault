import initSqlJs from 'sql.js/dist/sql-asm.js';

type SqlJsDatabase = any;
type SqlJsModule = {
  Database: new (data?: Uint8Array) => SqlJsDatabase;
};

let sqlJsPromise: Promise<SqlJsModule> | null = null;

export async function getSqlJs(): Promise<SqlJsModule> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({}) as Promise<SqlJsModule>;
  }
  return sqlJsPromise;
}
