import { Interface } from '@ethersproject/abi';
import { DeepReadonly } from 'ts-essentials';
import { Log, Logger, Address } from '../../types';
import { catchParseLogError, bigIntify } from '../../utils';
import { StatefulEventSubscriber } from '../../stateful-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { PoolState } from './types';
import EulerSwapPoolABI from '../../abi/eulerswap/eulerSwap.abi.json';
import { ethers } from 'ethers';
import { MultiCallParams, MultiResult } from '../../lib/multi-wrapper';
import { uint256ToBigInt } from '../../lib/decoders';

export class EulerswapEventPool extends StatefulEventSubscriber<PoolState> {
  handlers: {
    [event: string]: (
      event: any,
      state: DeepReadonly<PoolState>,
      log: Readonly<Log>,
    ) => DeepReadonly<PoolState> | null;
  } = {};

  logDecoder: (log: Log) => any;

  readonly asset0: Address;
  readonly asset1: Address;
  readonly eulerAccount: Address;
  readonly equilibriumReserve0: bigint;
  readonly equilibriumReserve1: bigint;
  readonly currReserve0: bigint;
  readonly currReserve1: bigint;
  readonly fee: bigint;
  readonly priceX: bigint;
  readonly priceY: bigint;
  readonly concentrationX: bigint;
  readonly concentrationY: bigint;
  readonly salt: string;

  private _poolAddress?: Address;

  public readonly poolIface = new Interface(EulerSwapPoolABI);

  public initFailed = false;
  public initRetryAttemptCount = 0;

  addressesSubscribed: string[];

  // The keccak256 hash of the pool contract creation code
  protected readonly poolInitCodeHash: string;

  protected _stateRequestCallData?: MultiCallParams<{
    reserve0: bigint;
    reserve1: bigint;
    status: number;
  }>[];

  get poolAddress() {
    if (this._poolAddress === undefined) {
      this._poolAddress = this._computePoolAddress(
        this.asset0,
        this.asset1,
        this.eulerAccount,
        this.equilibriumReserve0,
        this.equilibriumReserve1,
        this.currReserve0,
        this.currReserve1,
        this.fee,
        this.priceX,
        this.priceY,
        this.concentrationX,
        this.concentrationY,
        this.salt,
      );
    }
    return this._poolAddress;
  }

  set poolAddress(address: Address) {
    this._poolAddress = address.toLowerCase();
  }

  constructor(
    readonly parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
    readonly erc20Interface: Interface,
    protected readonly factoryAddress: Address,
    asset0: Address,
    asset1: Address,
    poolInitCodeHash: string,
    mapKey: string = '',
    equilibriumReserve0: bigint = 0n,
    equilibriumReserve1: bigint = 0n,
    currReserve0: bigint = 0n,
    currReserve1: bigint = 0n,
    fee: bigint = 0n,
    priceX: bigint = 0n,
    priceY: bigint = 0n,
    concentrationX: bigint = 0n,
    concentrationY: bigint = 0n,
    salt: string = '0x0000000000000000000000000000000000000000000000000000000000000000',
  ) {
    let poolKey = `${asset0}_${asset1}`;

    super(parentName, poolKey, dexHelper, logger, true, mapKey);

    this.asset0 = asset0.toLowerCase();
    this.asset1 = asset1.toLowerCase();
    this.eulerAccount = '0x0000000000000000000000000000000000000000';
    this.equilibriumReserve0 = equilibriumReserve0;
    this.equilibriumReserve1 = equilibriumReserve1;
    this.currReserve0 = currReserve0;
    this.currReserve1 = currReserve1;
    this.fee = fee;
    this.priceX = priceX;
    this.priceY = priceY;
    this.concentrationX = concentrationX;
    this.concentrationY = concentrationY;
    this.salt = salt;

    this.logDecoder = (log: Log) => this.poolIface.parseLog(log);
    this.addressesSubscribed = new Array<Address>(1);

    // Add handlers
    this.handlers['Swap'] = this.handleSwapEvent.bind(this);

    // Store the pool init code hash
    this.poolInitCodeHash = poolInitCodeHash;
  }

  /**
   * The function is called every time any of the subscribed
   * addresses release log. The function accepts the current
   * state, updates the state according to the log, and returns
   * the updated state.
   * @param state - Current state of event subscriber
   * @param log - Log released by one of the subscribed addresses
   * @returns Updates state of the event subscriber after the log
   */
  protected processLog(
    state: DeepReadonly<PoolState>,
    log: Readonly<Log>,
  ): DeepReadonly<PoolState> | null {
    try {
      const event = this.logDecoder(log);
      if (event.name in this.handlers) {
        return this.handlers[event.name](event, state, log);
      }
    } catch (e) {
      catchParseLogError(e, this.logger);
    }

    return null;
  }

  /**
   * The function generates state using on-chain calls. This
   * function is called to regenerate state if the event based
   * system fails to fetch events and the local state is no
   * more correct.
   * @param blockNumber - Blocknumber for which the state should
   * should be generated
   * @returns state of the event subscriber at blocknumber
   */
  async generateState(blockNumber: number): Promise<DeepReadonly<PoolState>> {
    const callData = this._getStateRequestCallData();

    const [reservesResult] = await this.dexHelper.multiWrapper.tryAggregate<{
      reserve0: bigint;
      reserve1: bigint;
      status: number;
    }>(
      false,
      callData,
      blockNumber,
      this.dexHelper.multiWrapper.defaultBatchSize,
      false,
    );

    if (!reservesResult.success) {
      this.logger.error(
        `EulerSwap: Failed to get reserves for pool ${this.poolAddress} at block ${blockNumber}`,
      );
      return {
        networkId: this.network,
        pool: this.poolAddress,
        blockTimestamp: 0n,
        reserve0: 0n,
        reserve1: 0n,
        status: 0,
        isValid: false,
      };
    }

    const { reserve0, reserve1, status } = reservesResult.returnData;

    return {
      networkId: this.network,
      pool: this.poolAddress,
      blockTimestamp: 0n, // TODO: Get block timestamp if needed
      reserve0,
      reserve1,
      status,
      isValid: true,
    };
  }

  protected _getStateRequestCallData() {
    if (!this._stateRequestCallData) {
      const callData: MultiCallParams<{
        reserve0: bigint;
        reserve1: bigint;
        status: number;
      }>[] = [
        {
          target: this.poolAddress,
          callData: this.poolIface.encodeFunctionData('getReserves'),
          decodeFunction: (
            returnData: ethers.BytesLike | MultiResult<ethers.BytesLike>,
          ) => {
            const data =
              typeof returnData === 'object' && 'success' in returnData
                ? returnData.returnData
                : returnData;
            const [reserve0, reserve1, status] =
              this.poolIface.decodeFunctionResult(
                'getReserves',
                ethers.utils.hexlify(data),
              );
            return {
              reserve0: bigIntify(reserve0),
              reserve1: bigIntify(reserve1),
              status: Number(status),
            };
          },
        },
      ];

      this._stateRequestCallData = callData;
    }
    return this._stateRequestCallData;
  }

  // Event handler for Swap event, return pool state after the swap
  handleSwapEvent(event: any, state: PoolState, log: Readonly<Log>): PoolState {
    const amount0In = bigIntify(event.args.amount0In);
    const amount1In = bigIntify(event.args.amount1In);
    const amount0Out = bigIntify(event.args.amount0Out);
    const amount1Out = bigIntify(event.args.amount1Out);

    state.reserve0 = bigIntify(event.args.reserve0);
    state.reserve1 = bigIntify(event.args.reserve1);
    state.isValid = true;

    return state;
  }

  protected _computePoolAddress(
    vault0: Address,
    vault1: Address,
    eulerAccount: Address,
    equilibriumReserve0: bigint,
    equilibriumReserve1: bigint,
    currReserve0: bigint,
    currReserve1: bigint,
    fee: bigint,
    priceX: bigint,
    priceY: bigint,
    concentrationX: bigint,
    concentrationY: bigint,
    salt: string, // bytes32 as hex string
  ): Address {
    // Create pool params struct
    const poolParams = {
      vault0,
      vault1,
      eulerAccount,
      equilibriumReserve0,
      equilibriumReserve1,
      currReserve0,
      currReserve1,
      fee,
    };

    // Create curve params struct
    const curveParams = {
      priceX,
      priceY,
      concentrationX,
      concentrationY,
    };

    // Encode pool params and curve params together
    const poolAndCurveParams = ethers.utils.defaultAbiCoder.encode(
      [
        'tuple(address vault0, address vault1, address eulerAccount, uint112 equilibriumReserve0, uint112 equilibriumReserve1, uint112 currReserve0, uint112 currReserve1, uint256 fee)',
        'tuple(uint256 priceX, uint256 priceY, uint256 concentrationX, uint256 concentrationY)',
      ],
      [poolParams, curveParams],
    );

    // Encode eulerAccount and salt
    const eulerAccountAndSalt = ethers.utils.defaultAbiCoder.encode(
      ['address', 'bytes32'],
      [eulerAccount, salt],
    );

    // Compute the salt for create2 address
    const saltHash = ethers.utils.keccak256(
      ethers.utils.solidityPack(
        ['bytes32', 'bytes'],
        [ethers.utils.keccak256(eulerAccountAndSalt), poolAndCurveParams],
      ),
    );

    return ethers.utils.getCreate2Address(
      this.factoryAddress,
      saltHash,
      this.poolInitCodeHash,
    );
  }
}
