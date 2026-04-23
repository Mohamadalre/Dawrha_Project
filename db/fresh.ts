import { DataSource } from "typeorm";
import { AppDataSource } from "./data-source";

async function fresh() {
  const dataSource = await AppDataSource.initialize();

  console.log("Dropping database...");

  await dataSource.dropDatabase();

  console.log("Running migrations...");

  await dataSource.runMigrations();

  console.log("Done ✔");

  await dataSource.destroy();
}

fresh();