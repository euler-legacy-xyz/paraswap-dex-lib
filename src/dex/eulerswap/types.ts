import { Address } from '../../types';
import { BigNumber, BytesLike } from 'ethers';
import { MultiResult } from '../../lib/multi-wrapper';
import { EulerSwapFactory } from './eulerswap-factory';
import { EulerswapEventPool } from './eulerswap-pool';

export type PoolState = {
  // poolState is the state of event
  // subscriber. This should be the minimum
  // set of parameters required to compute
  // pool prices. Complete me!
  networkId: number;
  pool: string;
  blockTimestamp: bigint;
  reserve0: bigint;
  reserve1: bigint;
  status: number;
  isValid: boolean;
};

export type FactoryState = Record<string, never>;

export type EulerswapData = {
  // TODO: EulerswapData is the dex data that is
  // returned by the API that can be used for
  // tx building. The data structure should be minimal.
  // Complete me!
  exchange: Address;
  amount0Out: string;
  amount1Out: string;
  isApproved?: boolean;
};

// export type DecodeStateMultiCallFunc = (
//   result: MultiResult<BytesLike> | BytesLike,
// ) => DecodedStateMultiCallResultWithRelativeBitmaps;

export type DexParams = {
  // TODO: DexParams is set of parameters the can
  // be used to initiate a DEX fork.
  // Complete me!
  factory: Address;
  periphery: Address;
  // stateMulticall: Address;
  deployer?: Address;
  subgraphURL?: string;
  initHash: string;
  eventPoolImplementation?: typeof EulerswapEventPool;
  factoryImplementation?: typeof EulerSwapFactory;
};
