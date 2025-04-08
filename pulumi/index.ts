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
let s3BucketOutput: pulumi.Output<string> | undefined;
let rdsEndpoint: pulumi.Output<string> | undefined;
let eksClusterOutput: pulumi.Output<string> | undefined;

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

if (config.getBoolean("createRDS") === true) {
  console.log("RDS creation requested. Proceeding...");

  const databasesRaw = config.require("pf:databases");
  const databases = JSON.parse(databasesRaw);

  if (databases.length > 0) {
    const dbInfo = databases[0];
    const dbName = dbInfo.dbName;
    const dbUsername = dbInfo.username;
    const dbPassword = config.requireSecret("dbPassword");
    const dbInstanceClass = "db.t3.micro";
    const dbEngine = "mysql";
    const dbEngineVersion = "8.0";
    const dbAllocatedStorage = 20;
    const dbMultiAz = false;
    const dbPubliclyAccessible = false;
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

    const rdsInstance = new aws.rds.Instance(
      dbInstanceIdentifier,
      {
        identifier: dbInstanceIdentifier,
        engine: dbEngine,
        engineVersion: dbEngineVersion,
        instanceClass: dbInstanceClass,
        allocatedStorage: dbAllocatedStorage,
        dbName: dbName,
        username: dbUsername,
        password: dbPassword,
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
    );

    rdsInstanceEndpoint = rdsInstance.endpoint.apply(
      (endpoint) => endpoint.split(":")[0]
    );
    rdsInstancePort = rdsInstance.port;

    console.log(`RDS Instance ${dbInstanceIdentifier} creation initiated.`);
    console.log(` -> DB Name: ${dbName}`);
    console.log(` -> Username: ${dbUsername}`);
    console.log(` -> Engine: ${dbEngine} ${dbEngineVersion}`);
    console.log(` -> Instance Class: ${dbInstanceClass}`);
  } else {
    console.log(
      "No database details provided in 'pf:databases' config. Skipping RDS creation."
    );
  }
} else {
  console.log("RDS creation not requested.");
}

if (config.getBoolean("createEKS") === true) {
  const eksClusterName = "fabulous-electro-gopher";
  const eksInstanceType = "t3.medium";
  const eksDesiredCapacity = 2;
  const eksMinSize = 1;
  const eksMaxSize = 3;
  const eksK8sVersion = config.get("eksK8sVersion") || "1.31";

  const nodeInstanceProfile = new aws.iam.InstanceProfile(
    "eksNodeInstanceProfile",
    {
      role: "AmazonEKSAutoNodeRole",
    }
  );

  const cluster = new eks.Cluster(
    "eksCluster",
    {
      name: eksClusterName,
      version: eksK8sVersion,
      vpcId: "vpc-04a0161c3cefe5035",
      publicSubnetIds: [
        "subnet-0a6f0e8d65f1fd095",
        "subnet-03309b9ea4ced012b",
        "subnet-0607d56e3d621b404",
        "subnet-0e6e3f6c7ee38aa7b",
        "subnet-02f60cf6daf7187d9",
        "subnet-0416b66f4749be8ba",
      ],
      nodeGroupOptions: {
        instanceProfileName: nodeInstanceProfile.name,
        instanceType: eksInstanceType,
        desiredCapacity: eksDesiredCapacity,
        minSize: eksMinSize,
        maxSize: eksMaxSize,
      },
      providerCredentialOpts: {
        profileName: config.get("awsProfile") || "default",
      },
    },
    { provider: awsProvider }
  );

  eksClusterOutput = cluster.eksCluster.name;
}

export { s3BucketOutput, rdsEndpoint, eksClusterOutput };
