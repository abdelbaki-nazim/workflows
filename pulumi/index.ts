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

if (config.getBoolean("createRDS") === true) {
  const rdsInstanceIdentifier = "database-pulumi";
  const databasesRaw = config.get("databases") || "[]";
  const databases = JSON.parse(databasesRaw);

  if (databases.length > 0) {
    const rdsCluster = new aws.rds.Cluster(
      `rds-cluster-${rdsInstanceIdentifier}`,
      {
        clusterIdentifier: rdsInstanceIdentifier,
        engine: "aurora-mysql",
        engineVersion: "8.0",
        databaseName: databases[0].dbName,
        masterUsername: databases[0].username,
        masterPassword: databases[0].password,
        skipFinalSnapshot: true,
        applyImmediately: true,
      },
      { provider: awsProvider }
    );

    rdsEndpoint = rdsCluster.endpoint;

    databases.forEach((db: any) => {
      const dbName = db.dbName;
      const dbUsername = db.username;
      const dbPassword = db.password;

      new aws.rds.ClusterInstance(
        `rds-instance-${dbName}`,
        {
          identifier: `${rdsInstanceIdentifier}-${dbName}`,
          clusterIdentifier: rdsCluster.clusterIdentifier,
          instanceClass: "db.t4g.micro",
          engine: "aurora-mysql",
          engineVersion: "8.0",
          publiclyAccessible: false,
          applyImmediately: true,
        },
        { provider: awsProvider }
      );

      new aws.rds.ClusterParameterGroup(
        `param-group-${dbName}`,
        {
          family: "aurora-mysql8.0",
          parameters: [{ name: "character_set_server", value: "utf8mb4" }],
        },
        { provider: awsProvider }
      );

      console.log(`Database ${dbName} created for user ${dbUsername}`);
    });
  } else {
    console.log("No databases specified for RDS creation.");
  }
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
