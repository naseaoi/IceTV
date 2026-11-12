import type { Pool, RowDataPacket } from 'mysql2/promise';

import type { IStorage } from '@/lib/types';

export async function resetMysqlTestData(storage: IStorage): Promise<void> {
  if (!process.env.MYSQL_TEST_URL?.trim()) {
    throw new Error('清理测试数据需要 MYSQL_TEST_URL');
  }
  await storage.getAdminConfig();
  const pool = (storage as unknown as { pool: Pool }).pool;
  const connection = await pool.getConnection();
  try {
    const [tables] = await connection.query<RowDataPacket[]>('SHOW TABLES');
    await connection.beginTransaction();
    for (const row of tables) {
      const table = String(Object.values(row)[0]).replace(/`/g, '``');
      await connection.query(`DELETE FROM \`${table}\``);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
