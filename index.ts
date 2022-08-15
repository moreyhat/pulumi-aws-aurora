import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

const config = new pulumi.Config();

// Create a VPC
const vpc = new aws.ec2.Vpc("vpc", {
    cidrBlock: "10.0.0.0/16",
    enableDnsHostnames: true,
});

// Create Internet Gateway
const igw = new aws.ec2.InternetGateway("igw", {
    vpcId: vpc.id,
    tags: {
        Name: "Aurora Clouster Internet Gateway"
    }
});

// Create subnets for Amazon Aurora
const available = aws.getAvailabilityZones({
    state: "available",
});

const publicSubnets: aws.ec2.Subnet[] = [];
const privateSubnets: aws.ec2.Subnet[] = [];
const availabilityZones: string[] = [];

available.then(available => {
    // Create private subnets
    available.names.forEach((availabilityZone, i) => {
        if (i < 3) {
            const subnet = new aws.ec2.Subnet(`private-subnet-${i}`, {
                vpcId: vpc.id,
                cidrBlock: `10.0.${i}.0/24`,
                availabilityZone: availabilityZone,
                tags: {
                    Name: `aurora-private-subnet-${i}`
                },
            });
            privateSubnets.push(subnet);
            availabilityZones.push(availabilityZone);
    }
    });

    // Create public route table
    const publicRouteTable = new aws.ec2.RouteTable("public-route-table", {
        vpcId: vpc.id,
    });
    new aws.ec2.Route("public-default-route", {
        routeTableId: publicRouteTable.id,
        destinationCidrBlock: "0.0.0.0/0",
        gatewayId: igw.id,
    });

    // Create public subnets
    available.names.forEach((availableZone, i) => {
        if (i < 3) {
            const subnet = new aws.ec2.Subnet(`public-subnet-${i}`, {
                vpcId: vpc.id,
                cidrBlock: `10.0.${privateSubnets.length + i}.0/24`,
                availabilityZone: availableZone,
                tags: {
                    Name: `aurora-public-subnet-${i}`
                },
            });
            new aws.ec2.RouteTableAssociation(`public-route-table-association-${i}`, {
                subnetId: subnet.id,
                routeTableId: publicRouteTable.id
            });
    
            publicSubnets.push(subnet)
        }
    });

    // Create Aurora Subnet Group
    const subnetGroup = new aws.rds.SubnetGroup("aurora-subnet-group", {
        subnetIds: privateSubnets.map(privateSubnet => privateSubnet.id),
        tags: {
            Name: "Aurora subnet group"
        },
    });

    // Create Aurora Cluster
    const auroraPostgreSql = new aws.rds.Cluster("aurora-postgre-sql-cluster", {
        availabilityZones: availabilityZones,
        clusterIdentifier: "aurorapostgresql",
        databaseName: "aurorapostgresql",
        engine: "aurora-postgresql",
        masterUsername: config.require("db-username"),
        masterPassword: config.require("db-password"),
        skipFinalSnapshot: true,
        dbSubnetGroupName: subnetGroup.name,
    });

    // Create Cluster Instance
    new aws.rds.ClusterInstance("cluster-instance", {
        identifier: "aurora-cluster-instance",
        clusterIdentifier: auroraPostgreSql.id,
        instanceClass: config.require("db-instance-class"),
        engine: "aurora-postgresql",
        engineVersion: auroraPostgreSql.engineVersion,
        dbSubnetGroupName: subnetGroup.name,
    });
});