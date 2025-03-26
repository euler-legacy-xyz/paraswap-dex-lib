import { Address } from '../../types';
import { BigNumber, BytesLike } from 'ethers';
import { MultiResult } from '../../lib/multi-wrapper';

export type Slot0 = {
  reserve0: bigint;
  reserve1: bigint;
  status: number;
};

export type PoolState = {
  // TODO: poolState is the state of event
  // subscriber. This should be the minimum
  // set of parameters required to compute
  // pool prices. Complete me!
  // networkId: number;
  // pool: string;
  // blockTimestamp: bigint;
  // slot0: Slot0;
  // isValid: boolean;
  // balance0: bigint;
  // balance1: bigint;
};

export type FactoryState = Record<string, never>;

export type EulerswapData = {
  // TODO: EulerswapData is the dex data that is
  // returned by the API that can be used for
  // tx building. The data structure should be minimal.
  // Complete me!
  exchange: Address;
  isApproved?: boolean;
};

// export type DecodeStateMultiCallFunc = (
//   result: MultiResult<BytesLike> | BytesLike,
// ) => DecodedStateMultiCallResultWithRelativeBitmaps;

export type DexParams = {
  // TODO: DexParams is set of parameters the can
  // be used to initiate a DEX fork.
  // Complete me!
  // factory: Address;
  // stateMulticall: Address;
  // deployer?: Address;
  // eventPoolImplementation?: typeof UniswapV3EventPool;
  // factoryImplementation?: typeof UniswapV3Factory;
};
