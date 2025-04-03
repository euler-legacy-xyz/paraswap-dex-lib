import { AsyncOrSync } from 'ts-essentials';
import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  SimpleExchangeParam,
  PoolLiquidity,
  Logger,
} from '../../types';
import { SwapSide, Network } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { EulerswapData } from './types';
import { SimpleExchange } from '../simple-exchange';
import { EulerswapConfig, PoolsToPreload } from './config';
import { EulerswapEventPool } from './eulerswap-pool';
import { Interface } from '@ethersproject/abi';
import ERC20ABI from '../../abi/erc20.json';
import { BytesLike } from '@ethersproject/bytes';
import { MultiResult } from '../../lib/multi-wrapper';
import EulerSwapPoolABI from '../../abi/eulerswap/eulerSwap.abi.json';
import EulerSwapFactoryABI from '../../abi/eulerswap/eulerSwapFactory.abi.json';
import EulerSwapPeripheryABI from '../../abi/eulerswap/eulerSwapPeriphery.abi.json';
import { EulerSwapFactory } from './eulerswap-factory';
import { Contract } from 'web3-eth-contract';

export class Eulerswap extends SimpleExchange implements IDex<EulerswapData> {
  // protected eventPools: EulerswapEventPool;
  readonly eventPools: Record<string, EulerswapEventPool | null> = {};

  readonly hasConstantPriceLargeAmounts = false;
  // TODO: set true here if protocols works only with wrapped asset
  readonly needWrapNative = true;

  readonly isFeeOnTransferSupported = false;

  readonly poolIface: Interface;
  readonly factoryIface: Interface;
  readonly peripheryIface: Interface;
  private factoryInstance: EulerSwapFactory;
  private peripheryContract: Contract;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(EulerswapConfig);

  logger: Logger;

  intervalTask?: NodeJS.Timeout;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    protected config = EulerswapConfig[dexKey][network],
    protected poolsToPreload = PoolsToPreload[dexKey]?.[network] || [],
  ) {
    super(dexHelper, dexKey);
    this.logger = dexHelper.getLogger(dexKey);
    this.poolIface = new Interface(EulerSwapPoolABI);
    this.factoryIface = new Interface(EulerSwapFactoryABI);
    this.peripheryIface = new Interface(EulerSwapPeripheryABI);
    this.factoryInstance = this.getFactoryInstance();
    this.peripheryContract = new this.dexHelper.web3Provider.eth.Contract(
      EulerSwapPeripheryABI as any,
      this.config.periphery,
    );
  }

  protected getFactoryInstance(): EulerSwapFactory {
    return new EulerSwapFactory(
      this.dexHelper,
      this.dexKey,
      this.config.factory,
      this.logger,
      async () => {}, // Empty callback for now
      this.dexKey,
    );
  }

  // Initialize pricing is called once in the start of
  // pricing service. It is intended to setup the integration
  // for pricing requests. It is optional for a DEX to
  // implement this function
  async initializePricing(blockNumber: number) {
    // Initialize the factory to start listening for events
    await this.factoryInstance.initialize(blockNumber);
  }

  // Legacy: was only used for V5
  // Returns the list of contract adapters (name and index)
  // for a buy/sell. Return null if there are no adapters.
  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return null;
  }

  // Returns list of pool identifiers that can be used
  // for a given swap. poolIdentifiers must be unique
  // across DEXes. It is recommended to use
  // ${dexKey}_${poolAddress} as a poolIdentifier
  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    side: SwapSide,
    blockNumber: number,
  ): Promise<string[]> {
    const _srcToken = this.dexHelper.config.wrapETH(srcToken);
    const _destToken = this.dexHelper.config.wrapETH(destToken);

    const [_srcAddress, _destAddress] = this._getLoweredAddresses(
      _srcToken,
      _destToken,
    );

    if (_srcAddress === _destAddress) return [];

    try {
      // Get all pools for this pair in a single call using factory
      const poolAddresses = await this.factoryInstance.poolsByPair(
        _srcAddress,
        _destAddress,
        blockNumber,
      );

      // Create pool identifiers for each pool address
      return Promise.all(
        poolAddresses.map((poolAddress: string) =>
          this.getPoolIdentifier(_srcAddress, _destAddress, poolAddress),
        ),
      );
    } catch (e) {
      this.logger.error(
        `Error_getPoolIdentifiers: ${_srcAddress} ${_destAddress}`,
        e,
      );
      return [];
    }
  }

  async getPoolIdentifier(
    srcAddress: Address,
    destAddress: Address,
    poolAddress: Address,
  ): Promise<string> {
    // Simple pool identifier format
    return `${this.dexKey}_${poolAddress}`;

    /*
    // Detailed pool identifier with immutable parameters
    const tokenAddresses = this._sortTokens(srcAddress, destAddress).join('_');

    // Create aggregated calls to get all immutable parameters
    const calls = [
      {
        target: poolAddress,
        callData: this.poolIface.encodeFunctionData('vault0'),
        decodeFunction: (returnData: BytesLike | MultiResult<BytesLike>) => {
          const data = typeof returnData === 'object' && 'success' in returnData 
            ? returnData.returnData 
            : returnData;
          return this.poolIface.decodeFunctionResult('vault0', data)[0];
        },
      },
      {
        target: poolAddress,
        callData: this.poolIface.encodeFunctionData('vault1'),
        decodeFunction: (returnData: BytesLike | MultiResult<BytesLike>) => {
          const data = typeof returnData === 'object' && 'success' in returnData 
            ? returnData.returnData 
            : returnData;
          return this.poolIface.decodeFunctionResult('vault1', data)[0];
        },
      },
      {
        target: poolAddress,
        callData: this.poolIface.encodeFunctionData('eulerAccount'),
        decodeFunction: (returnData: BytesLike | MultiResult<BytesLike>) => {
          const data = typeof returnData === 'object' && 'success' in returnData 
            ? returnData.returnData 
            : returnData;
          return this.poolIface.decodeFunctionResult('eulerAccount', data)[0];
        },
      },
      {
        target: poolAddress,
        callData: this.poolIface.encodeFunctionData('equilibriumReserve0'),
        decodeFunction: (returnData: BytesLike | MultiResult<BytesLike>) => {
          const data = typeof returnData === 'object' && 'success' in returnData 
            ? returnData.returnData 
            : returnData;
          return this.poolIface.decodeFunctionResult('equilibriumReserve0', data)[0];
        },
      },
      {
        target: poolAddress,
        callData: this.poolIface.encodeFunctionData('equilibriumReserve1'),
        decodeFunction: (returnData: BytesLike | MultiResult<BytesLike>) => {
          const data = typeof returnData === 'object' && 'success' in returnData 
            ? returnData.returnData 
            : returnData;
          return this.poolIface.decodeFunctionResult('equilibriumReserve1', data)[0];
        },
      },
      {
        target: poolAddress,
        callData: this.poolIface.encodeFunctionData('feeMultiplier'),
        decodeFunction: (returnData: BytesLike | MultiResult<BytesLike>) => {
          const data = typeof returnData === 'object' && 'success' in returnData 
            ? returnData.returnData 
            : returnData;
          return this.poolIface.decodeFunctionResult('feeMultiplier', data)[0];
        },
      },
      {
        target: poolAddress,
        callData: this.poolIface.encodeFunctionData('priceX'),
        decodeFunction: (returnData: BytesLike | MultiResult<BytesLike>) => {
          const data = typeof returnData === 'object' && 'success' in returnData 
            ? returnData.returnData 
            : returnData;
          return this.poolIface.decodeFunctionResult('priceX', data)[0];
        },
      },
      {
        target: poolAddress,
        callData: this.poolIface.encodeFunctionData('priceY'),
        decodeFunction: (returnData: BytesLike | MultiResult<BytesLike>) => {
          const data = typeof returnData === 'object' && 'success' in returnData 
            ? returnData.returnData 
            : returnData;
          return this.poolIface.decodeFunctionResult('priceY', data)[0];
        },
      },
      {
        target: poolAddress,
        callData: this.poolIface.encodeFunctionData('concentrationX'),
        decodeFunction: (returnData: BytesLike | MultiResult<BytesLike>) => {
          const data = typeof returnData === 'object' && 'success' in returnData 
            ? returnData.returnData 
            : returnData;
          return this.poolIface.decodeFunctionResult('concentrationX', data)[0];
        },
      },
      {
        target: poolAddress,
        callData: this.poolIface.encodeFunctionData('concentrationY'),
        decodeFunction: (returnData: BytesLike | MultiResult<BytesLike>) => {
          const data = typeof returnData === 'object' && 'success' in returnData 
            ? returnData.returnData 
            : returnData;
          return this.poolIface.decodeFunctionResult('concentrationY', data)[0];
        },
      },
    ];

    try {
      const results = await this.dexHelper.multiWrapper.aggregate(calls);

      const [
        vault0,
        vault1,
        eulerAccount,
        equilibriumReserve0,
        equilibriumReserve1,
        feeMultiplier,
        priceX,
        priceY,
        concentrationX,
        concentrationY,
      ] = results;

      return `${this.dexKey}_${tokenAddresses}_${vault0}_${vault1}_${eulerAccount}_${equilibriumReserve0}_${equilibriumReserve1}_${feeMultiplier}_${priceX}_${priceY}_${concentrationX}_${concentrationY}`;
    } catch (e) {
      this.logger.error(
        `Error_getPoolIdentifier: ${poolAddress}`,
        e,
      );
      // Fallback to basic identifier if we can't get all parameters
      return `${this.dexKey}_${tokenAddresses}`;
    }
    */
  }

  // Returns pool prices for amounts.
  // If limitPools is defined only pools in limitPools
  // should be used. If limitPools is undefined then
  // any pools can be used.
  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<EulerswapData>> {
    const _srcToken = this.dexHelper.config.wrapETH(srcToken);
    const _destToken = this.dexHelper.config.wrapETH(destToken);

    const [_srcAddress, _destAddress] = this._getLoweredAddresses(
      _srcToken,
      _destToken,
    );

    if (_srcAddress === _destAddress) return null;

    try {
      let poolAddresses: string[];

      if (limitPools) {
        // If limitPools is provided, extract pool addresses from the identifiers
        poolAddresses = limitPools.map(identifier => {
          const parts = identifier.split('_');
          return parts[1]; // The pool address is the second part after dexKey
        });
      } else {
        // If no limitPools, get all pools for the pair
        poolAddresses = await this.factoryInstance.poolsByPair(
          _srcAddress,
          _destAddress,
          blockNumber,
        );
      }

      if (poolAddresses.length === 0) return null;

      const calls = poolAddresses.flatMap(poolAddress =>
        amounts.map(amount => ({
          target: this.config.periphery,
          callData:
            side === SwapSide.SELL
              ? this.peripheryIface.encodeFunctionData('quoteExactInput', [
                  poolAddress,
                  _srcAddress,
                  _destAddress,
                  amount.toString(),
                ])
              : this.peripheryIface.encodeFunctionData('quoteExactOutput', [
                  poolAddress,
                  _srcAddress,
                  _destAddress,
                  amount.toString(),
                ]),
          decodeFunction: (returnData: BytesLike | MultiResult<BytesLike>) => {
            const data =
              typeof returnData === 'object' && 'success' in returnData
                ? returnData.returnData
                : returnData;
            return this.peripheryIface.decodeFunctionResult(
              side === SwapSide.SELL ? 'quoteExactInput' : 'quoteExactOutput',
              data,
            )[0];
          },
        })),
      );

      const results = await this.dexHelper.multiWrapper.aggregate(calls);
      const unit =
        BigInt(10) **
        BigInt(side === SwapSide.SELL ? destToken.decimals : srcToken.decimals);

      // Determine token order and which amount is out
      const isToken0Src = _srcAddress < _destAddress;
      const isSell = side === SwapSide.SELL;

      // Group results by pool
      const poolResults = poolAddresses.map((poolAddress, poolIndex) => {
        const startIndex = poolIndex * amounts.length;
        const endIndex = startIndex + amounts.length;
        const poolPrices = results
          .slice(startIndex, endIndex)
          .map(result => BigInt(result));

        return {
          unit,
          data: {
            exchange: poolAddress,
            // For SELL: if token0 is src, then amount1 is out, else amount0 is out
            // For BUY: if token0 is src, then amount0 is out, else amount1 is out
            amount0Out: isToken0Src === isSell ? '0' : poolPrices[0].toString(),
            amount1Out: isToken0Src === isSell ? poolPrices[0].toString() : '0',
          },
          poolAddresses: [poolAddress],
          exchange: this.dexKey,
          gasCost: 0,
          poolIdentifier: `${this.dexKey}_${poolAddress}`,
          prices: poolPrices,
        };
      });

      return poolResults;
    } catch (e) {
      this.logger.error(
        `Error_getPricesVolume: ${_srcAddress} ${_destAddress}`,
        e,
      );
      return null;
    }
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(poolPrices: PoolPrices<EulerswapData>): number | number[] {
    // Function selector (4 bytes)
    const FUNCTION_SELECTOR = CALLDATA_GAS_COST.FUNCTION_SELECTOR;

    // amount0Out and amount1Out (2 * uint256)
    const AMOUNT = 2 * CALLDATA_GAS_COST.AMOUNT;

    // to address (20 bytes)
    const ADDRESS = CALLDATA_GAS_COST.ADDRESS;

    // data length (1 byte) + data (variable)
    const DATA_LENGTH = CALLDATA_GAS_COST.LENGTH_SMALL;
    const DATA = 0; // We don't know the exact data length, so we'll use 0 as base

    // Total gas cost
    const totalGasCost =
      FUNCTION_SELECTOR + AMOUNT + ADDRESS + DATA_LENGTH + DATA;

    return totalGasCost;
  }

  // Encode params required by the exchange adapter
  // V5: Used for multiSwap, buy & megaSwap
  // V6: Not used, can be left blank
  // Hint: abiCoder.encodeParameter() could be useful
  getAdapterParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: EulerswapData,
    side: SwapSide,
  ): AdapterExchangeParam {
    // TODO: complete me!
    const { exchange } = data;

    // Encode here the payload for adapter
    const payload = '';

    return {
      targetExchange: exchange,
      payload,
      networkFee: '0',
    };
  }

  // This is called once before getTopPoolsForToken is
  // called for multiple tokens. This can be helpful to
  // update common state required for calculating
  // getTopPoolsForToken. It is optional for a DEX
  // to implement this
  async updatePoolState(): Promise<void> {
    // TODO: complete me!
  }

  // Returns list of top pools based on liquidity. Max
  // limit number pools should be returned.
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    //TODO: complete me!
    return [];
  }

  // This is optional function in case if your implementation has acquired any resources
  // you need to release for graceful shutdown. For example, it may be any interval timer
  releaseResources(): AsyncOrSync<void> {
    if (this.intervalTask !== undefined) {
      clearInterval(this.intervalTask);
      this.intervalTask = undefined;
    }
  }

  protected _getLoweredAddresses(srcToken: Token, destToken: Token) {
    return [srcToken.address.toLowerCase(), destToken.address.toLowerCase()];
  }

  protected _sortTokens(srcAddress: Address, destAddress: Address) {
    return [srcAddress, destAddress].sort((a, b) => (a < b ? -1 : 1));
  }
}
