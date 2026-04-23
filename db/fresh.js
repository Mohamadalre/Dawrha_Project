"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const data_source_1 = require("./data-source");
async function fresh() {
    const dataSource = await data_source_1.AppDataSource.initialize();
    console.log("Dropping database...");
    await dataSource.dropDatabase();
    console.log("Running migrations...");
    await dataSource.runMigrations();
    console.log("Done ✔");
    await dataSource.destroy();
}
fresh();
//# sourceMappingURL=fresh.js.map