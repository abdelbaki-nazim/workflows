import * as automation from "@pulumi/pulumi/automation";
import * as path from "path";

export async function runDeployment() {
  const workDir = path.resolve("../p2");

  const stackName = process.env.STACK_NAME as string;
  const stack = await automation.LocalWorkspace.createOrSelectStack({
    stackName,
    workDir,
  });

  await stack.setConfig("awsAccessKey", {
    value: process.env.AWS_ACCESS_KEY_ID || "",
  });
  await stack.setConfig("awsSecretKey", {
    value: process.env.AWS_SECRET_ACCESS_KEY || "",
    secret: true,
  });
  await stack.setConfig("awsRegion", {
    value: process.env.AWS_REGION || "us-east-1",
  });
  await stack.setConfig("createS3", {
    value: process.env.CREATE_S3 || "",
  });
  await stack.setConfig("createRDS", {
    value: process.env.CREATE_RDS || "",
  });
  await stack.setConfig("createEKS", {
    value: process.env.CREATE_EKS || "",
  });
  await stack.setConfig("s3BucketName", {
    value: process.env.S3_BUCKET_NAME || "",
  });

  // Combine separate DB values into a JSON array for the 'databases' config.
  const dbName = process.env.DB_NAME;
  const dbUsername = process.env.DB_USERNAME;
  const dbPassword = process.env.DB_PASSWORD;
  let databasesConfig = "[]";

  if (dbName) {
    databasesConfig = JSON.stringify([
      { dbName, username: dbUsername || "", password: dbPassword || "" },
    ]);
  }
  await stack.setConfig("databases", {
    value: databasesConfig,
  });

  console.log("Deploying...");
  const upResult = await stack.up({ onOutput: console.info });
  console.log("Done:", upResult.outputs);
  return upResult.outputs;
}
