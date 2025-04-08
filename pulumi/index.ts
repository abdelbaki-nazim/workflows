import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as eks from "@pulumi/eks";
import { Region } from "@pulumi/aws";

const config = new pulumi.Config();

// Retrieve required configuration values.
const awsAccessKey = config.require("awsAccessKey");
const awsSecretKey = config.requireSecret("awsSecretKey");
const awsRegion = config.require("awsRegion");

// Create an AWS provider with the specified credentials.
const awsProvider = new aws.Provider("aws-provider", {
  accessKey: awsAccessKey,
  secretKey: awsSecretKey,
  region: awsRegion as Region,
});

// Define variables to hold resource outputs.
export let s3BucketOutput: pulumi.Output<string> | undefined;
// S3 Bucket Creation
if (config.getBoolean("createS3") === true) {
  const s3BucketName = config.get("s3BucketName") || "default-s3-bucket";

  const bucket = new aws.s3.Bucket(
    `bucket-${s3BucketName}`,
    {
      bucket: s3BucketName,
    },
    { provider: awsProvider }
  );
  s3BucketOutput = bucket.bucket;
}

export let rdsInstanceEndpoint: pulumi.Output<string> | undefined;
export let rdsInstancePort: pulumi.Output<number> | undefined;
// RDS Creation
if (config.getBoolean("createRDS") === true) {
  console.log("RDS creation requested. Proceeding...");

  const databasesSecretJson = config.requireSecret("databases");

  const dbDetails = databasesSecretJson.apply((jsonString) => {
    const databases = JSON.parse(jsonString);
    if (databases.length > 0) {
      return {
        dbName: databases[0].dbName as string,
        dbUsername: databases[0].username as string,
        dbPassword: databases[0].password as pulumi.Output<string>,
        isValid: true,
      };
    }
    return { isValid: false };
  });

  if (dbDetails.isValid) {
    const dbInstanceClass = "db.t3.micro";
    const dbEngine = "mysql";
    const dbEngineVersion = "8.0";
    const dbAllocatedStorage = 20;
    const dbMultiAz = false;
    const dbPubliclyAccessible = true;
    const dbParameterFamily = "mysql8.0";

    const hardcodedPrivateSubnetIds = [
      "subnet-0607d56e3d621b404",
      "subnet-02f60cf6daf7187d9",
    ];
    const hardcodedVpcSecurityGroupIds = ["sg-032569d223f9915df"];

    const dbSubnetGroup = new aws.rds.SubnetGroup(
      `${pulumi.getStack()}-dbsubnetgroup`,
      {
        name: `${pulumi.getStack()}-dbsubnetgroup`,
        subnetIds: hardcodedPrivateSubnetIds,
        tags: {
          Name: `${pulumi.getStack()}-dbsubnetgroup`,
          Environment: pulumi.getStack(),
        },
      },
      { provider: awsProvider }
    );

    const dbParameterGroup = new aws.rds.ParameterGroup(
      `${pulumi.getStack()}-dbparamgroup`,
      {
        name: `${pulumi.getStack()}-dbparamgroup`,
        family: dbParameterFamily,
        parameters: [
          { name: "character_set_server", value: "utf8mb4" },
          { name: "character_set_client", value: "utf8mb4" },
        ],
        tags: {
          Name: `${pulumi.getStack()}-dbparamgroup`,
          Environment: pulumi.getStack(),
        },
      },
      { provider: awsProvider }
    );

    const dbInstanceIdentifier = `${pulumi.getStack()}-db-instance`;

    const rdsInstance = pulumi
      .all([dbDetails.dbName, dbDetails.dbUsername, dbDetails.dbPassword])
      .apply(
        ([name, user, pass]) =>
          new aws.rds.Instance(
            dbInstanceIdentifier,
            {
              identifier: dbInstanceIdentifier,
              engine: dbEngine,
              engineVersion: dbEngineVersion,
              instanceClass: dbInstanceClass,
              allocatedStorage: dbAllocatedStorage,
              dbName: name,
              username: user,
              password: pass,
              dbSubnetGroupName: dbSubnetGroup.name,
              parameterGroupName: dbParameterGroup.name,
              vpcSecurityGroupIds: hardcodedVpcSecurityGroupIds,
              multiAz: dbMultiAz,
              publiclyAccessible: dbPubliclyAccessible,
              skipFinalSnapshot: true,
              applyImmediately: true,
              tags: {
                Name: dbInstanceIdentifier,
                Environment: pulumi.getStack(),
              },
            },
            {
              provider: awsProvider,
              dependsOn: [dbSubnetGroup, dbParameterGroup],
            }
          )
      );

    rdsInstanceEndpoint = rdsInstance.endpoint.apply(
      (endpoint) => endpoint.split(":")[0]
    );
    rdsInstancePort = rdsInstance.port;

    console.log(`RDS Instance ${dbInstanceIdentifier} creation initiated.`);
    console.log(` -> Engine: ${dbEngine} ${dbEngineVersion}`);
    console.log(` -> Instance Class: ${dbInstanceClass}`);
  } else {
    console.log(
      "No database details provided in 'databases' config. Skipping RDS creation."
    );
  }
} else {
  console.log("RDS creation not requested.");
}

export let eksClusterOutput: pulumi.Output<string> | undefined;
// EKS Creation
if (config.getBoolean("createEKS") === true) {
  console.log("EKS creation requested. Proceeding...");

  const eksClusterName =
    config.get("clusterName") || `${pulumi.getStack()}-eks-cluster`;
  const eksInstanceType = "t3.medium";
  const eksDesiredCapacity = 2;
  const eksMinSize = 1;
  const eksMaxSize = 3;
  const eksK8sVersion = "1.31";

  const vpcId = "vpc-0e4c18d71fea58af1";

  const publicSubnetsPromise: Promise<aws.ec2.GetSubnetsResult> =
    aws.ec2.getSubnets({
      filters: [
        { name: "vpc-id", values: [vpcId] },
        { name: "tag:SubnetType", values: ["public"] },
      ],
    });

  const publicSubnetIdsOutput: pulumi.Output<string[]> = pulumi
    .output(publicSubnetsPromise)
    .apply((subnetsResult: aws.ec2.GetSubnetsResult) => subnetsResult.ids);

  try {
    const cluster = new eks.Cluster(
      `eksCluster`,
      {
        name: eksClusterName,
        version: eksK8sVersion,
        vpcId: vpcId,
        publicSubnetIds: publicSubnetIdsOutput,
        nodeGroupOptions: {
          instanceType: eksInstanceType,
          desiredCapacity: eksDesiredCapacity,
          minSize: eksMinSize,
          maxSize: eksMaxSize,
        },
        tags: {
          Name: eksClusterName,
          Environment: pulumi.getStack(),
        },
      },
      {
        provider: awsProvider,
        customTimeouts: { create: "30m", update: "30m", delete: "20m" },
      }
    );

    eksClusterOutput = cluster.eksCluster.name;
    console.log(`EKS Cluster ${eksClusterName} creation initiated.`);
  } catch (error) {
    console.error(
      `Error during EKS Cluster ${eksClusterName} creation: ${error}`
    );
    throw error; // Re-throw error to fail the Pulumi update if needed
  }
} else {
  console.log("EKS creation not requested.");
}
