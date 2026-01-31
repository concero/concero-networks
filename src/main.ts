import axios from 'axios';
import fs from 'fs';
import * as process from 'process';
import { Chain, DeploymentAddress, DeploymentType } from './types';
import { calcHash } from './hash';

const v2ContractsBranch = 'master';
const rpcsBranch = 'master';
const networksBranch = 'master';

type OldNetwork = {
    name: string;
    chainId: number;
    chainSelector: number;
    rpcUrls: [];
    blockExplorers: {
        name: string;
        url: string;
        apiUrl: string;
    }[];
    nativeCurrency: {
        name: string;
        symbol: string;
        decimals: number;
    };
    finalityConfirmations: number;
    finalityTagEnabled?: boolean;
    minBlockConfirmations?: number;
};
type OldRPCs = {
    rpcUrls: string[];
    chainSelector: number;
    chainId: string;
    finalityTagEnabled?: boolean;
};

type ChainType = 'testnet' | 'mainnet' | 'stage';

const toCamelCaseKey = (raw: string) =>
    raw
        .toLowerCase()
        .split('_')
        .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
        .join('');

function buildExtractPipe(
    envText: string,
    regex: RegExp,
    deploymentType: DeploymentType,
    deployments: Record<string, Partial<Record<DeploymentType, DeploymentAddress>>>,
): void {
    let match: RegExpExecArray | null;

    while ((match = regex.exec(envText))) {
        const [, chainRaw, address] = match;

        const chainName = toCamelCaseKey(chainRaw);
        deployments[chainName] = {
            ...deployments[chainName],
            [deploymentType]: address as DeploymentAddress,
        };
    }
}

export const pipeRouterDeployments = (
    envText: string,
    deployments: Record<string, Partial<Record<DeploymentType, DeploymentAddress>>>,
) =>
    buildExtractPipe(
        envText,
        /CONCERO_ROUTER_PROXY_(?!ADMIN_)([A-Z0-9_]+)\s*=\s*(0x[a-fA-F0-9]{40})/g,
        DeploymentType.Router,
        deployments,
    );

export const pipeRelayerLibDeployments = (
    envText: string,
    deployments: Record<string, Partial<Record<DeploymentType, DeploymentAddress>>>,
) =>
    buildExtractPipe(
        envText,
        /CONCERO_RELAYER_LIB_PROXY_(?!ADMIN_)([A-Z0-9_]+)\s*=\s*(0x[a-fA-F0-9]{40})/g,
        DeploymentType.RelayerLib,
        deployments,
    );

export const pipeValidatorLibDeployments = (
    envText: string,
    deployments: Record<string, Partial<Record<DeploymentType, DeploymentAddress>>>,
) =>
    buildExtractPipe(
        envText,
        /CONCERO_CRE_VALIDATOR_LIB_PROXY_(?!ADMIN_)([A-Z0-9_]+)\s*=\s*(0x[a-fA-F0-9]{40})/g,
        DeploymentType.ValidatorLib,
        deployments,
    );

const main = async () => {
    const mainnetChains: Record<Chain['chainSelector'], Chain> = {};
    const testnetChains: Record<Chain['chainSelector'], Chain> = {};
    const stageChains: Record<Chain['chainSelector'], Chain> = {};

    const [
        { data: mainnetDeployments },
        { data: testnetDeployments },
        { data: stageDeployments },
        { data: mainnetRPCs },
        { data: testnetRPCs },
        { data: mainnetNetworks },
        { data: testnetNetworks },
    ] = await Promise.all([
        axios.get<string>(
            `https://raw.githubusercontent.com/concero/messaging-contracts-v2/refs/heads/${v2ContractsBranch}/.env.deployments.mainnet`,
        ),
        axios.get<string>(
            `https://raw.githubusercontent.com/concero/messaging-contracts-v2/refs/heads/${v2ContractsBranch}/.env.deployments.testnet`,
        ),
        axios.get<string>(
            `https://raw.githubusercontent.com/concero/messaging-contracts-v2/refs/heads/${v2ContractsBranch}/.env.deployments.stage`,
        ),
        axios.get<Record<string, OldRPCs>>(
            `https://raw.githubusercontent.com/concero/rpcs/refs/heads/${rpcsBranch}/output/mainnet.json`,
        ),
        axios.get<Record<string, OldRPCs>>(
            `https://raw.githubusercontent.com/concero/rpcs/refs/heads/${rpcsBranch}/output/testnet.json`,
        ),
        axios.get<Record<string, OldNetwork>>(
            `https://raw.githubusercontent.com/concero/v2-networks/refs/heads/${networksBranch}/dist/networks/mainnet.json`,
        ),
        axios.get<Record<string, OldNetwork>>(
            `https://raw.githubusercontent.com/concero/v2-networks/refs/heads/${networksBranch}/dist/networks/testnet.json`,
        ),
    ]);

    const enrich = (chainSelector: Chain['chainSelector'], rawChain: OldNetwork, type: ChainType) => {
        const rpcUrls = [
            ...(mainnetRPCs?.[rawChain.name]?.rpcUrls?.length ? mainnetRPCs?.[rawChain.name]?.rpcUrls : []),
            ...(testnetRPCs?.[rawChain.name]?.rpcUrls?.length ? testnetRPCs?.[rawChain.name]?.rpcUrls : []),
            ...rawChain?.rpcUrls,
        ];
        if (!rpcUrls.length) return;

        const targetDeployments = type === 'stage' ? stageDeploymentsMap[rawChain.name] : deployments[rawChain.name];
        if (!targetDeployments) return;

        const chain = {
            id: rawChain.chainId.toString(),
            ...(rawChain.finalityTagEnabled && { finalityTagEnabled: true }),
            ...(rawChain.finalityConfirmations && { finalityConfirmations: rawChain.finalityConfirmations }),
            ...((rawChain.finalityConfirmations !== undefined || rawChain.finalityTagEnabled) && {
                isFinalitySupported: true,
            }),
            chainSelector: rawChain.chainSelector,
            name: rawChain.name,
            rpcUrls,
            nativeCurrency: {
                name: rawChain.nativeCurrency.name,
                decimals: rawChain.nativeCurrency.decimals,
                symbol: rawChain.nativeCurrency.symbol,
            },
            ...(rawChain.minBlockConfirmations && { minBlockConfirmations: rawChain.minBlockConfirmations }),
            deployments: targetDeployments,
        };

        if (type === 'testnet') {
            testnetChains[chainSelector] = chain;
        } else if (type === 'stage') {
            stageChains[chainSelector] = chain;
        } else {
            mainnetChains[chainSelector] = chain;
        }
    };

    const deployments: Record<string, Partial<Record<DeploymentType, DeploymentAddress>>> = {};
    const fullDeploymentsEnv = mainnetDeployments + testnetDeployments;
    pipeRouterDeployments(fullDeploymentsEnv, deployments);
    pipeRelayerLibDeployments(fullDeploymentsEnv, deployments);
    pipeValidatorLibDeployments(fullDeploymentsEnv, deployments);

    const stageDeploymentsMap: Record<string, Partial<Record<DeploymentType, DeploymentAddress>>> = {};
    pipeRouterDeployments(stageDeployments, stageDeploymentsMap);
    pipeRelayerLibDeployments(stageDeployments, stageDeploymentsMap);
    pipeValidatorLibDeployments(stageDeployments, stageDeploymentsMap);

    Object.values(mainnetNetworks).map(network => {
        enrich(network.chainSelector, network, 'mainnet');
    });

    Object.values(testnetNetworks).map(network => {
        enrich(network.chainSelector, network, 'testnet');
    });

    Object.values(testnetNetworks).map(network => {
        if (!stageDeploymentsMap[network.name]) return;
        enrich(network.chainSelector, network, 'stage');
    });

    fs.writeFileSync(`${process.cwd()}/output/chains.mainnet.json`, JSON.stringify(mainnetChains, null, 2));
    fs.writeFileSync(`${process.cwd()}/output/chains.mainnet.minified.json`, JSON.stringify(mainnetChains));

    fs.writeFileSync(`${process.cwd()}/output/chains.testnet.json`, JSON.stringify(testnetChains, null, 2));
    fs.writeFileSync(`${process.cwd()}/output/chains.testnet.minified.json`, JSON.stringify(testnetChains));

    fs.writeFileSync(`${process.cwd()}/output/chains.stage.json`, JSON.stringify(stageChains, null, 2));
    fs.writeFileSync(`${process.cwd()}/output/chains.stage.minified.json`, JSON.stringify(stageChains));

    fs.writeFileSync(
        `${process.cwd()}/output/chains.json`,
        JSON.stringify({ ...testnetChains, ...mainnetChains }, null, 2),
    );
    fs.writeFileSync(
        `${process.cwd()}/output/chains.minified.json`,
        JSON.stringify({ ...testnetChains, ...mainnetChains }),
    );
};

main().then(() => calcHash());
