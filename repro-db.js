const path = require('path');
const { DataSource } = require('typeorm');
const ds = new DataSource({
  type: 'postgres',
  host: '127.0.0.1', port: 5432, username: 'postgres', password: 'Ff123456', database: 'dawrha_db',
  entities: [path.join(__dirname, 'dist', 'src', '**', '*.entity.js')],
  synchronize: false,
});
ds.initialize().then(async () => {
  console.log('DB connected', 'entities:', ds.entityMetadatas.length);
  try {
    const cp = ds.getRepository('CoveragePoint');
    const points = await cp.find({ where: { isActive: true } });
    console.log('points count', points.length);
    const withDistance = points.map(p => ({...p, distance_km: 1})).filter(p=>p.distance_km<=10);
    console.log('withDistance', withDistance.length);
    if (withDistance.length) {
      const pointIds = withDistance.map(p=>p.id);
      const dca = ds.getRepository('DriverCoverageAssignment');
      console.log('querying assignments with relations...');
      const assignments = await dca.find({
        where: pointIds.map(id => ({ coveragePointId: id, isActive: true })),
        relations: ['driver','driver.account','driver.shift','driver.assignment','driver.assignment.truck'],
      });
      console.log('assignments', assignments.length);
      console.log('SUCCESS - no throw on find');
    }
  } catch (e) {
    console.log('THROW:', e.message);
    console.log((e.stack||'').split('\n').slice(0,12).join('\n'));
  } finally {
    await ds.destroy();
  }
}).catch(e => { console.log('INIT ERR', e.message); });
