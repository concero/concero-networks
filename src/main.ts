import axios from "axios";
import fs from "fs";
import * as process from "process";
import {Chain, DeploymentAddress, DeploymentType} from "./types";

const v2ContractsBranch = 'feature/v3/dev'
const rpcsBranch = 'master'
const networksBranch = 'master'

type OldNetwork = {
    name: string,
    chainId: number,
    chainSelector: number,
    rpcUrls: [],
    blockExplorers:  {
        name: string,
        url: string,
        apiUrl: string
    }[],
    nativeCurrency: {
        name: string,
        symbol: string,
        decimals: number
    },
    finalityConfirmations: number
}
type OldRPCs = {
    rpcUrls: string[], chainSelector: number, chainId: string
}


const toCamelCaseKey = (raw: string) => raw
    .toLowerCase()
    .split('_')
    .map((p, i) =>
        i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)
    )
    .join('');

function buildExtractPipe(
    envText: string,
    regex: RegExp,
    deploymentType: DeploymentType,
    deployments: Record<string, Partial<Record<DeploymentType, DeploymentAddress>>>
): void {
    let match: RegExpExecArray | null;

    while (match = regex.exec(envText)) {
        const [, chainRaw, address] = match;

        const chainName = toCamelCaseKey(chainRaw);

        deployments[chainName] = {
            ...deployments[chainName],
            [deploymentType]: address as DeploymentAddress,
        };
    }
}


export const pipeRouterDeployments = (envText: string, deployments: Record<string, Partial<Record<DeploymentType, DeploymentAddress>>>) =>
    buildExtractPipe(envText, /CONCERO_ROUTER_PROXY_(?!ADMIN_)([A-Z0-9_]+)\s*=\s*(0x[a-fA-F0-9]{40})/g, DeploymentType.Router, deployments)

export const pipeRelayerLibDeployments = (envText: string, deployments: Record<string, Partial<Record<DeploymentType, DeploymentAddress>>>) =>
    buildExtractPipe(envText, /CONCERO_RELAYER_LIB_([A-Z0-9_]+)\s*=\s*(0x[a-fA-F0-9]{40})/g, DeploymentType.RelayerLib, deployments)

const main = async () => {
    const chains: Record<Chain['chainSelector'], Chain> = {}

    const [
        {data: mainnetDeployments},
        {data: testnetDeployments},
        {data: mainnetRPCs},
        {data: testnetRPCs},
        {data: mainnetNetworks},
        {data: testnetNetworks}
    ] = await Promise.all([
        axios.get<string>(`https://raw.githubusercontent.com/concero/messaging-contracts-v2/refs/heads/${v2ContractsBranch}/.env.deployments.mainnet`),
        axios.get<string>(`https://raw.githubusercontent.com/concero/messaging-contracts-v2/refs/heads/${v2ContractsBranch}/.env.deployments.testnet`),
        axios.get<Record<string, OldRPCs>>(
        `https://raw.githubusercontent.com/concero/rpcs/refs/heads/${rpcsBranch}/output/mainnet.json`
        ),
        axios.get<Record<string, OldRPCs>>(
        `https://raw.githubusercontent.com/concero/rpcs/refs/heads/${rpcsBranch}/output/testnet.json`
        ),
        axios.get<Record<string, OldNetwork>>(
            `https://raw.githubusercontent.com/concero/v2-networks/refs/heads/${networksBranch}/dist/networks/mainnet.json`
        ),
        axios.get<Record<string, OldNetwork>>(
            `https://raw.githubusercontent.com/concero/v2-networks/refs/heads/${networksBranch}/dist/networks/testnet.json`
        )
    ])

    const deployments: Record<string, Partial<Record<DeploymentType, DeploymentAddress>>> = {}
    pipeRouterDeployments(mainnetDeployments + testnetDeployments, deployments)
    pipeRelayerLibDeployments(mainnetDeployments + testnetDeployments , deployments)

    Object.values(mainnetNetworks).map(network => {
        const rpcUrls = [...mainnetRPCs?.[network.name]?.rpcUrls, ...network?.rpcUrls]
        chains[network.chainSelector] = {
            id: network.chainId,
            isTestnet: false,
            chainSelector: network.chainSelector,
            name: network.name,
            rpcUrls,
            nativeCurrency: {name: network.nativeCurrency.name, decimals: network.nativeCurrency.decimals, symbol: network.nativeCurrency.symbol},
            blockExplorers: network.blockExplorers.map(i => ({name: i.name, url: i.url, apiUrl: i.apiUrl})),
            finalityConfirmations: network.finalityConfirmations,
            deployments: deployments[network.name] ?? {}
        }
    })
    Object.values(testnetNetworks).map(network => {
        const rpcUrls = [...testnetRPCs?.[network.name]?.rpcUrls, ...network?.rpcUrls]
        chains[network.chainSelector] = {
            id: network.chainId,
            isTestnet: true,
            chainSelector: network.chainSelector,
            name: network.name,
            rpcUrls,
            nativeCurrency: {name: network.nativeCurrency.name, decimals: network.nativeCurrency.decimals, symbol: network.nativeCurrency.symbol},
            blockExplorers: network.blockExplorers.map(i => ({name: i.name, url: i.url, apiUrl: i.apiUrl})),
            finalityConfirmations: network.finalityConfirmations,
            deployments: deployments[network.name] ?? {}
        }
    })


    fs.writeFile(process.cwd() + '/output/' + 'chains.json', JSON.stringify(chains, null, 2), () => {})
    fs.writeFile(process.cwd() + '/output/' + 'chains.minified.json', JSON.stringify(chains), () => {})
    console.log({mainnetDeployments, testnetDeployments, mainnetRPCs, testnetRPCs, mainnetNetworks, testnetNetworks})
}

main()
