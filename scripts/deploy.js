const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("=".repeat(50));
  console.log(`Network:  ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(balance)} SHM`);
  console.log("=".repeat(50));

  if (balance === 0n) {
    console.error("\nERROR: Your deployer account has 0 SHM.");
    console.error("Please add funds to your wallet before deploying.\n");
    process.exit(1);
  }

  console.log("\nDeploying OperationsRegistry...");
  const Registry = await ethers.getContractFactory("OperationsRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  
  const address = await registry.getAddress();
  console.log(`\nOperationsRegistry deployed to: ${address}`);
  console.log(`Explorer: https://explorer-mezame.shardeum.org/address/${address}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
