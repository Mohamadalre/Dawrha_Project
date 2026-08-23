const { Client } = require('pg');
const client = new Client({
  host: '127.0.0.1', port: 5432, user: 'postgres', password: 'Ff123456', database: 'dawrha_db',
});
const tables = [
  'accounts',
  'collector_profiles',
  'trucks',
  'truck_assignments',
  'shifts',
  'truck_handovers',
  'driver_coverage_assignments',
  'coverage_points',
  'collection_requests',
  'collection_routes',
];
(async () => {
  await client.connect();
  for (const t of tables) {
    try {
      const r = await client.query(
        `select column_name, data_type, is_nullable, column_default
         from information_schema.columns where table_name=$1 order by ordinal_position`,
        [t]
      );
      console.log(`\n===== ${t} (${r.rowCount} cols) =====`);
      for (const c of r.rows) {
        console.log(`  ${c.column_name}  ${c.data_type}  null=${c.is_nullable}  def=${c.column_default || ''}`);
      }
    } catch (e) {
      console.log(`\n===== ${t} ERROR: ${e.message}`);
    }
  }
  await client.end();
})();
