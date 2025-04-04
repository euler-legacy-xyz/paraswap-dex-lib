import { DexParams } from './types';
import { DexConfigMap } from '../../types';
import { Network, SwapSide } from '../../constants';
import { Address } from '../../types';

// Pools that will be initialized on app startup
// They are added for testing
export const PoolsToPreload: DexConfigMap<
  { token0: Address; token1: Address }[]
> = {
  UniswapV3: {
    [Network.MAINNET]: [
      {
        token0: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'.toLowerCase(),
        token1: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'.toLowerCase(),
      },
      {
        token0: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619'.toLowerCase(),
        token1: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'.toLowerCase(),
      },
    ],
  },
};

export const EulerswapConfig: DexConfigMap<DexParams> = {
  Eulerswap: {
    [Network.MAINNET]: {
      factory: '0x79d3a7a9d203d352a655255BdB1a233623f536B7',
      periphery: '0x829e7c83886323980BE76CedD837905cCEc3D738',
      initHash:
        '0xcc469c6a985bd7c7c9f42991e8bf16ce2bfdfe7cc4158f555afb89ca75bd7b53',
    },
  },
};
