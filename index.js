const utils = require('./utils')
const syscointx = require('syscointx-js')
const BN = require('bn.js')
/* SyscoinJSLib
Purpose: Top level object used by consuming libraries to craft Syscoin/Bitcoin transactions. For Syscoin SPT support is provided
Param HDSigner: Optional. If letting SyscoinJSLib manage XPUB keys you would want to use an HDSigner. With HDSigner assigned, signing will happen automatically when creating raw transactions.
Param blockbookURL: Optional. A backend blockbook URL that will provide UTXO and required information to sign. User can always provide their own list of UTXO's in the same format as blockbook using utils.sanitizeBlockbookUTXOs to sanitize the UTXO data to acceptable internal format
Param network: Optional. The blockchain network and bip32 settings. The utils file has some examples including Bitcoin and Syscoin, it will default to Syscoin.
*/
function SyscoinJSLib (HDSigner, blockbookURL, network) {
  this.blockbookURL = blockbookURL
  if (HDSigner) {
    this.HDSigner = HDSigner
    this.HDSigner.blockbookURL = blockbookURL
    this.network = network || this.HDSigner.network
  } else {
    this.HDSigner = null
    this.network = network || utils.syscoinNetworks.mainnet
  }
}

// proxy to signAndSend
SyscoinJSLib.prototype.signAndSendWithHDSigner = async function (psbt, HDSignerIn, notaryAssets) {
  return this.signAndSend(psbt, notaryAssets, HDSignerIn)
}

/* signAndSend
Purpose: Signs/Notarizes if necessary and Sends transaction to network using HDSigner
Param psbt: Required. The resulting PSBT object passed in which is assigned from syscointx.createTransaction()/syscointx.createAssetTransaction()
Param notaryAssets: Optional. Asset objects that are required for notarization, fetch signatures via fetchNotarizationFromEndPoint()
Param HDSignerIn: Optional. HDSigner used to sign transaction
Returns: PSBT signed success or unsigned if failure
*/
SyscoinJSLib.prototype.signAndSend = async function (psbt, notaryAssets, HDSignerIn) {
  // notarize if necessary
  const HDSigner = HDSignerIn || this.HDSigner
  const psbtClone = psbt.clone()
  psbt = await HDSigner.sign(psbt)
  let tx = null
  // if not complete, we shouldn't notarize or try to send to network must get more signatures so return it to client
  try {
    // will fail if not complete
    tx = psbt.extractTransaction()
  } catch (err) {
    console.log('Transaction incomplete, requires more signatures...')
    return psbt
  }
  if (notaryAssets) {
    // check to see if notarization was already done
    const allocations = utils.getAllocationsFromTx(tx)
    const emptySig = Buffer.alloc(65, 0)
    let needNotary = false
    for (let i = 0; i < allocations.length; i++) {
      // if notarySignature exists and is an empty signature (default prior to filling) then we need to notarize this asset allocation send
      if (allocations[i].notarysig && allocations[i].notarysig.length > 0 && allocations[i].notarysig.equals(emptySig)) {
        needNotary = true
        break
      }
    }
    // if notarization is required
    if (needNotary) {
      const notarizedDetails = await utils.notarizePSBT(psbt, notaryAssets, psbt.extractTransaction().toHex())
      if (notarizedDetails && notarizedDetails.output) {
        psbt = HDSigner.copyPSBT(psbtClone, notarizedDetails.index, notarizedDetails.output)
        psbt = await HDSigner.sign(psbt)
        try {
          // will fail if not complete
          psbt.extractTransaction()
        } catch (err) {
          console.log('Transaction incomplete, requires more signatures...')
          return psbt
        }
      } else {
        return psbt
      }
    }
  }
  if (this.blockbookURL) {
    const resSend = await utils.sendRawTransaction(this.blockbookURL, psbt.extractTransaction().toHex(), HDSigner)
    if (resSend.error) {
      throw Object.assign(
        new Error('could not send tx! error: ' + resSend.error.message),
        { code: 402 }
      )
    } else if (resSend.result) {
      console.log('tx successfully sent! txid: ' + resSend.result)
      return psbt
    } else {
      throw Object.assign(
        new Error('Unrecognized response from backend: ' + resSend),
        { code: 402 }
      )
    }
  }
  return psbt
}

/* signAndSendWithWIF
Purpose: Signs/Notarizes if necessary and Sends transaction to network using WIF
Param psbt: Required. The resulting PSBT object passed in which is assigned from syscointx.createTransaction()/syscointx.createAssetTransaction()
Param wif: Required. Private key in WIF format to sign inputs of the transaction for
Param notaryAssets: Optional. Asset objects that are required for notarization, fetch signatures via fetchNotarizationFromEndPoint()
Returns: PSBT signed success or unsigned if failure
*/
SyscoinJSLib.prototype.signAndSendWithWIF = async function (psbt, wif, notaryAssets, HDSignerIn) {
  // notarize if necessary
  const HDSigner = HDSignerIn || this.HDSigner
  const psbtClone = psbt.clone()
  psbt = await utils.signWithWIF(psbt, wif, this.network)
  let tx = null
  // if not complete, we shouldn't notarize or try to send to network must get more signatures so return it to client
  try {
    // will fail if not complete
    tx = psbt.extractTransaction()
  } catch (err) {
    return psbt
  }
  if (notaryAssets) {
    // check to see if notarization was already done
    const allocations = utils.getAllocationsFromTx(tx)
    const emptySig = Buffer.alloc(65, 0)
    let needNotary = false
    for (let i = 0; i < allocations.length; i++) {
      // if notarySignature exists and is an empty signature (default prior to filling) then we need to notarize this asset allocation send
      if (allocations[i].notarysig && allocations[i].notarysig.length > 0 && allocations[i].notarysig.equals(emptySig)) {
        needNotary = true
        break
      }
    }
    // if notarization is required
    if (needNotary) {
      const notarizedDetails = await utils.notarizePSBT(psbt, notaryAssets, psbt.extractTransaction().toHex())
      if (notarizedDetails && notarizedDetails.output) {
        psbt = HDSigner.copyPSBT(psbtClone, notarizedDetails.index, notarizedDetails.output)
        psbt = await utils.signWithWIF(psbt, wif, this.network)
        try {
          // will fail if not complete
          psbt.extractTransaction()
        } catch (err) {
          return psbt
        }
      } else {
        return psbt
      }
    }
  }
  if (this.blockbookURL) {
    const resSend = await utils.sendRawTransaction(this.blockbookURL, psbt.extractTransaction().toHex())
    if (resSend.error) {
      throw Object.assign(
        new Error('could not send tx! error: ' + resSend.error.message),
        { code: 402 }
      )
    } else if (resSend.result) {
      console.log('tx successfully sent! txid: ' + resSend.result)
      return psbt
    } else {
      throw Object.assign(
        new Error('Unrecognized response from backend: ' + resSend),
        { code: 402 }
      )
    }
  }
  return psbt
}
/* fetchAndSanitizeUTXOs
Purpose: Fetch UTXO's for an address or XPUB from backend Blockbook provider and sanitize them for use by upstream libraries
Param utxos: Optional. Pass in specific utxos to fund a transaction, should be sanitized using utils.sanitizeBlockbookUTXOs()
Param fromXpubOrAddress: Optional. If wanting to fund from specific XPUB's or addresses specify this field should be set. Can be an array of XPUB or addresses in combination.
Param txOpts: Optional. Transaction options. Fields are described below:
  Field rbf. Optional. True by default. Replace-by-fee functionality allowing one to bump transaction by increasing fee for UTXOs used.
  Field assetWhiteList. Optional. null by default. Allows UTXO's to be added from assets in the whitelist or the asset being sent
Param assetMap: Optional (For asset transactions only). Description of Map:
  Index assetGuid. Required. Numeric Asset GUID you are sending to
  Value is described below:
    Field changeAddress. Optional. Where asset change outputs will be sent to. If it is not there or null a new change address will be created. If HDSigner is not set, it will send asset change outputs to sysChangeAddress
    Field outputs. Required. Array of objects described below:
      Field value. Required. Big Number representing satoshi's to send. Should be 0 if doing an update.
      Field address. Optional. Destination address for asset.
  Example:
    const assetMap = new Map([
      [assetGuid, { outputs: [{ value: new BN(0), address: 'tsys1qdflre2yd37qtpqe2ykuhwandlhq04r2td2t9ae' }] }]
    ])
    Would update assetGuid asset and send it as change back to 'tsys1qdflre2yd37qtpqe2ykuhwandlhq04r2td2t9ae'. Change is the 0-value UTXO for asset ownership.
Param excludeZeroConf: Optional. False by default. Filtering out 0 conf UTXO, new/update/send asset transactions must use confirmed inputs only as per Syscoin Core mempool policy
Returns: Returns JSON object in response, sanitized UTXO object array in JSON
*/
SyscoinJSLib.prototype.fetchAndSanitizeUTXOs = async function (utxos, fromXpubOrAddress, txOpts, assetMap, excludeZeroConf) {
  if (!utxos) {
    if (fromXpubOrAddress) {
      if (!Array.isArray(fromXpubOrAddress)) {
        fromXpubOrAddress = [fromXpubOrAddress]
      }
      const utxoRequests = []
      const concatSanitizedUTXOS = {}
      fromXpubOrAddress.forEach(addressOrXpub => utxoRequests.push(utils.fetchBackendUTXOS(this.blockbookURL, addressOrXpub)))
      const responses = await Promise.all(utxoRequests)
      responses.forEach(response => {
        const utxos = utils.sanitizeBlockbookUTXOs(response.addressOrXpub, response, this.network, txOpts, assetMap, excludeZeroConf)
        if (!concatSanitizedUTXOS.utxos) {
          concatSanitizedUTXOS.utxos = utxos.utxos
        } else {
          concatSanitizedUTXOS.utxos = [...concatSanitizedUTXOS.utxos].concat([...utxos.utxos])
        }
        if (!concatSanitizedUTXOS.assets && utxos.assets) {
          concatSanitizedUTXOS.assets = utxos.assets
        } else if (concatSanitizedUTXOS.assets && utxos.assets) {
          concatSanitizedUTXOS.assets = new Map([...concatSanitizedUTXOS.assets].concat([...utxos.assets]))
        }
      })
      utxos = concatSanitizedUTXOS
      utxos.utxos = Object.values(utxos.utxos).reduce(function (r, k) {
        return r.concat(k)
      }, [])
    } else if (this.HDSigner) {
      utxos = await utils.fetchBackendUTXOS(this.blockbookURL, this.HDSigner.getAccountXpub())
      utxos = utils.sanitizeBlockbookUTXOs(fromXpubOrAddress, utxos, this.network, txOpts, assetMap, excludeZeroConf)
    }
  } else {
    utxos = utils.sanitizeBlockbookUTXOs(fromXpubOrAddress, utxos, this.network, txOpts, assetMap, excludeZeroConf)
  }
  return utxos
}
/* createTransaction
Purpose: Send Syscoin or Bitcoin or like coins.
Param txOpts: Optional. Transaction options. Fields are described below:
  Field rbf. Optional. True by default. Replace-by-fee functionality allowing one to bump transaction by increasing fee for UTXOs used.
  Field assetWhiteList. Optional. null by default. Allows UTXO's to be added from assets in the whitelist or the asset being sent
Param changeAddress: Optional. Change address if defined is where change outputs are sent to. If not defined and HDSigner is defined then a new change address will be automatically created using the next available change address index in the HD path
Param outputsArr: Required. Output array defining tuples to which addresses to send coins to and how much
Param feeRate: Optional. Defaults to 10 satoshi per byte. How many satoshi per byte the network fee should be paid out as.
Param fromXpubOrAddress: Optional. If wanting to fund from a specific XPUB or address specify this field should be set
Param utxos: Optional. Pass in specific utxos to fund a transaction, should be sanitized using utils.sanitizeBlockbookUTXOs()
Returns: PSBT if if HDSigner is set or result object which is used to create PSBT and sign/send if xpub/address are passed in to fund transaction
*/
SyscoinJSLib.prototype.createTransaction = async function (txOpts, changeAddress, outputsArr, feeRate, fromXpubOrAddress, utxos) {
  if (this.HDSigner) {
    if (!changeAddress) {
      changeAddress = await this.HDSigner.getNewChangeAddress()
    }
  }
  utxos = await this.fetchAndSanitizeUTXOs(utxos, fromXpubOrAddress, txOpts)
  const res = syscointx.createTransaction(txOpts, utxos, changeAddress, outputsArr, feeRate, this.network)
  const psbt = await this.HDSigner.createPSBTFromRes(res)
  if (fromXpubOrAddress) {
    return { psbt: psbt, res: psbt, assets: utils.getAssetsRequiringNotarization(psbt, utxos.assets) }
  }
  return await this.signAndSend(psbt, utils.getAssetsRequiringNotarization(psbt, utxos.assets))
}

/* convertToTrezorFormat
Purpose: Convert psbt output to trezor format.
Param txOpts: Optional. Transaction options. Fields are described below:
  Field rbf. Optional. True by default. Replace-by-fee functionality allowing one to bump transaction by increasing fee for UTXOs used.
  Field assetWhiteList. Optional. null by default. Allows UTXO's to be added from assets in the whitelist or the asset being sent
Param changeAddress: Optional. Change address if defined is where change outputs are sent to. If not defined and HDSigner is defined then a new change address will be automatically created using the next available change address index in the HD path
Param outputsArr: Required. Output array defining tuples to which addresses to send coins to and how much
Param feeRate: Optional. Defaults to 10 satoshi per byte. How many satoshi per byte the network fee should be paid out as.
Param fromXpubOrAddress: Optional. If wanting to fund from a specific XPUB or address specify this field should be set
Param utxos: Optional. Pass in specific utxos to fund a transaction, should be sanitized using utils.sanitizeBlockbookUTXOs()
Returns: PSBT if if HDSigner is set or result object which is used to create PSBT and sign/send if xpub/address are passed in to fund transaction
*/
SyscoinJSLib.prototype.convertToTrezorFormat = async function (txVersion, inputs, outputs) {
}

/* assetNew
Purpose: Create new Syscoin SPT.
Param assetOpts: Required. Asset details. Fields described below:
  Field precision. Required. Digits precision for this asset. Range is 0 to 8
  Field symbol. Required. Symbol up to 8 characters in length in ASCII.
  Field maxsupply. Required. Maximum satoshis for supply. Range is 1 to 1 quintillion (10^18)
  Field description. Optional. Description in ASCII describing token. The description will be encoded via JSON in the pubdata field for the asset and will be in the 'desc' field of the JSON object.
  Field contract. Optional. ERC20 address of the contract connected to this SPT for use in the SysEthereum bridge.
  Field notarykeyid. Optional. Notary KeyID, the hash160 of the address used for notarization. Should be P2WPKH.
  Field notarydetails. Optional. Notary Details, Fields described below:
    Field endpoint. Required. Fully qualified URL of the notary endpoint. The endpoint will be sent a POST request with transaction hex and some other details in a JSON object and requires a signature signing the transaction following notarization protocol.
    Field instanttransfers. Optional. Default is 0 (false). Instant transfers by blocking double-spends from inputs. Since notarization is happening via API the API can block any double-spend attempts thereby allowing for instant transactions.
    Field hdrequired. Optional. Default is 0 (false). If HD account XPUB and HD path information is required by the notary to verify change addresses belong to the sender account.
  Field auxfeedetails. Optional. Enforce auxiliary fees to every transaction on this asset. Fields described below:
    Field auxfeekeyid. Required. AuxFee KeyID, the hash160 of the address used where fees are paid out to. Should be P2WPKH.
    Field auxfees. Required. Array of AuxFee amounts based on total value being sent. Fields described below:
      Field bound. Required. The amount threshold (in satoshi) where if total output value for this asset is at or above this amount apply a percentage fee.
      Field percent. Required. Percent of total output value applied as a fee. Multiplied by 1000 to avoid floating point precision. For example 1% would be entered as 1000. 0.5% would be entered as 500. 0.001% would be entered as 1 (tenth of a basis point).
  Field updatecapabilityflags. Optional. Defaults to 127 or ALL capabilities. Update capabilities on this asset. Fields are masks which are described below:
    Mask 0 (No flags enabled)
    Mask 1 (ASSET_UPDATE_DATA, can you update public data field?)
    Mask 2 (ASSET_UPDATE_CONTRACT, can you update smart contract field?)
    Mask 4 (ASSET_UPDATE_SUPPLY, can you issue or distribute supply via assetsend?)
    Mask 8 (ASSET_UPDATE_NOTARY_KEY, can you update notary address?)
    Mask 16 (ASSET_UPDATE_NOTARY_DETAILS, can you update notary details?)
    Mask 32 (ASSET_UPDATE_AUXFEE, can you update aux fees?)
    Mask 64 (ASSET_UPDATE_CAPABILITYFLAGS, can you update capability flags?)
    Mask 127 (ASSET_CAPABILITY_ALL, All flags enabled)
Param txOpts: Optional. Transaction options. Fields are described below:
  Field rbf. Optional. True by default. Replace-by-fee functionality allowing one to bump transaction by increasing fee for UTXOs used. Will be overrided to False, cannot be set to True for new asset transactions.
  Field assetWhiteList. Optional. null by default. Allows UTXO's to be added from assets in the whitelist or the asset being sent
Param sysChangeAddress: Optional. Change address if defined is where Syscoin only change outputs are sent to. If not defined and HDSigner is defined then a new change address will be automatically created using the next available change address index in the HD path
Param sysReceivingAddress: Optional. Address which will hold the new asset. If not defined and HDSigner is defined then a new receiving address will be automatically created using the next available receiving address index in the HD path
Param feeRate: Optional. Defaults to 10 satoshi per byte. How many satoshi per byte the network fee should be paid out as.
Param sysFromXpubOrAddress: Optional. If wanting to fund from a specific XPUB or address specify this field should be set
Param utxos: Optional. Pass in specific utxos to fund a transaction, should be sanitized using utils.sanitizeBlockbookUTXOs()
Returns: PSBT if if HDSigner is set or result object which is used to create PSBT and sign/send if xpub/address are passed in to fund transaction
*/
SyscoinJSLib.prototype.assetNew = async function (assetOpts, txOpts, sysChangeAddress, sysReceivingAddress, feeRate, sysFromXpubOrAddress, utxos) {
  if (this.HDSigner) {
    if (!sysChangeAddress) {
      sysChangeAddress = await this.HDSigner.getNewChangeAddress()
    }
    if (!sysReceivingAddress) {
      sysReceivingAddress = await this.HDSigner.getNewReceivingAddress()
    }
  }
  // create dummy map where GUID will be replaced by deterministic one based on first input txid, we need this so fees will be accurately determined on first place of coinselect
  const assetMap = new Map([
    ['0', { changeAddress: sysChangeAddress, outputs: [{ value: new BN(0), address: sysReceivingAddress }] }]
  ])
  // true last param for filtering out 0 conf UTXO, new/update/send asset transactions must use confirmed inputs only as per Syscoin Core mempool policy
  utxos = await this.fetchAndSanitizeUTXOs(utxos, sysFromXpubOrAddress, txOpts, assetMap, true)
  const res = syscointx.assetNew(assetOpts, txOpts, utxos, assetMap, sysChangeAddress, feeRate)
  const psbt = await this.HDSigner.createPSBTFromRes(res)
  if (sysFromXpubOrAddress) {
    return { psbt: psbt, res: psbt, assets: utils.getAssetsRequiringNotarization(psbt, utxos.assets) }
  }
  return await this.signAndSend(psbt, utils.getAssetsRequiringNotarization(psbt, utxos.assets))
}

/* assetUpdate
Purpose: Update existing Syscoin SPT.
Param assetGuid: Required. Asset GUID to update.
Param assetMap: Required. Description of Map:
  Index assetGuid. Required. Numeric Asset GUID you are sending to
  Value is described below:
    Field changeAddress. Optional. Where asset change outputs will be sent to. If it is not there or null a new change address will be created. If HDSigner is not set, it will send asset change outputs to sysChangeAddress
    Field outputs. Required. Array of objects described below:
      Field value. Required. Big Number representing satoshi's to send. Should be 0 if doing an update.
      Field address. Optional. Destination address for asset.
  Example:
    const assetMap = new Map([
      [assetGuid, { outputs: [{ value: new BN(0), address: 'tsys1qdflre2yd37qtpqe2ykuhwandlhq04r2td2t9ae' }] }]
    ])
    Would update assetGuid asset and send it as change back to 'tsys1qdflre2yd37qtpqe2ykuhwandlhq04r2td2t9ae'. Change is the 0-value UTXO for asset ownership.
Param assetOpts: Required. Asset details. Fields described below:
  Field description. Optional. Description in ASCII describing token. The description will be encoded via JSON in the pubdata field for the asset and will be in the 'desc' field of the JSON object.
  Field contract. Optional. ERC20 address of the contract connected to this SPT for use in the SysEthereum bridge.
  Field notarykeyid. Optional. Notary KeyID, the hash160 of the address used for notarization. Should be P2WPKH.
  Field notarydetails. Optional. Notary Details, Fields described below:
    Field endpoint. Required. Fully qualified URL of the notary endpoint. The endpoint will be sent a POST request with transaction hex and some other details in a JSON object and requires a signature signing the transaction following notarization protocol.
    Field instanttransfers. Optional. Default is 0 (false). Instant transfers by blocking double-spends from inputs. Since notarization is happening via API the API can block any double-spend attempts thereby allowing for instant transactions.
    Field hdrequired. Optional. Default is 0 (false). If HD account XPUB and HD path information is required by the notary to verify change addresses belong to the sender account.
  Field auxfeedetails. Optional. Enforce auxiliary fees to every transaction on this asset. Fields described below:
    Field auxfeekeyid. Required. AuxFee KeyID, the hash160 of the address used where fees are paid out to. Should be P2WPKH.
    Field auxfees. Required. Array of AuxFee amounts based on total value being sent. Fields described below:
      Field bound. Required. The amount threshold (in satoshi) where if total output value for this asset is at or above this amount apply a percentage fee.
      Field percent. Required. Percent of total output value applied as a fee. Multiplied by 1000 to avoid floating point precision. For example 1% would be entered as 1000. 0.5% would be entered as 500. 0.001% would be entered as 1 (tenth of a basis point).
  Field updatecapabilityflags. Optional. Defaults to 127 or ALL capabilities. Update capabilities on this asset. Fields are masks which are described below:
    Mask 0 (No flags enabled)
    Mask 1 (ASSET_UPDATE_DATA, can you update public data field?)
    Mask 2 (ASSET_UPDATE_CONTRACT, can you update smart contract field?)
    Mask 4 (ASSET_UPDATE_SUPPLY, can you issue or distribute supply via assetsend?)
    Mask 8 (ASSET_UPDATE_NOTARY_KEY, can you update notary address?)
    Mask 16 (ASSET_UPDATE_NOTARY_DETAILS, can you update notary details?)
    Mask 32 (ASSET_UPDATE_AUXFEE, can you update aux fees?)
    Mask 64 (ASSET_UPDATE_CAPABILITYFLAGS, can you update capability flags?)
    Mask 127 (ASSET_CAPABILITY_ALL, All flags enabled)
Param txOpts: Optional. Transaction options. Fields are described below:
  Field rbf. Optional. True by default. Replace-by-fee functionality allowing one to bump transaction by increasing fee for UTXOs used.
  Field assetWhiteList. Optional. null by default. Allows UTXO's to be added from assets in the whitelist or the asset being sent
Param sysChangeAddress: Optional. Change address if defined is where Syscoin only change outputs are sent to. Does not apply to asset change outputs which are definable in the assetOpts object. If not defined and HDSigner is defined then a new change address will be automatically created using the next available change address index in the HD path
Param feeRate: Optional. Defaults to 10 satoshi per byte. How many satoshi per byte the network fee should be paid out as.
Param sysFromXpubOrAddress: Optional. If wanting to fund from a specific XPUB or address specify this field should be set
Param utxos: Optional. Pass in specific utxos to fund a transaction, should be sanitized using utils.sanitizeBlockbookUTXOs()
Returns: PSBT if if HDSigner is set or result object which is used to create PSBT and sign/send if xpub/address are passed in to fund transaction
*/
SyscoinJSLib.prototype.assetUpdate = async function (assetGuid, assetOpts, txOpts, assetMap, sysChangeAddress, feeRate, sysFromXpubOrAddress, utxos) {
  if (!utxos) {
    if (sysFromXpubOrAddress) {
      utxos = await utils.fetchBackendUTXOS(this.blockbookURL, sysFromXpubOrAddress)
    } else if (this.HDSigner) {
      utxos = await utils.fetchBackendUTXOS(this.blockbookURL, this.HDSigner.getAccountXpub())
    }
  }
  if (this.HDSigner) {
    for (const valueAssetObj of assetMap.values()) {
      if (!valueAssetObj.changeAddress) {
        valueAssetObj.changeAddress = await this.HDSigner.getNewChangeAddress()
      }
    }
    if (!sysChangeAddress) {
      sysChangeAddress = await this.HDSigner.getNewChangeAddress()
    }
  }
  // true last param for filtering out 0 conf UTXO, new/update/send asset transactions must use confirmed inputs only as per Syscoin Core mempool policy
  utxos = await this.fetchAndSanitizeUTXOs(utxos, sysFromXpubOrAddress, txOpts, assetMap, true)
  const res = syscointx.assetUpdate(assetGuid, assetOpts, txOpts, utxos, assetMap, sysChangeAddress, feeRate)
  const psbt = await this.HDSigner.createPSBTFromRes(res)
  if (sysFromXpubOrAddress) {
    return { psbt: psbt, res: psbt, assets: utils.getAssetsRequiringNotarization(psbt, utxos.assets) }
  }
  return await this.signAndSend(psbt, utils.getAssetsRequiringNotarization(psbt, utxos.assets))
}

/* assetSend
Purpose: Issue supply by sending it from asset to an address holding an allocation of the asset.
Param txOpts: Optional. Transaction options. Fields are described below:
  Field rbf. Optional. True by default. Replace-by-fee functionality allowing one to bump transaction by increasing fee for UTXOs used.
  Field assetWhiteList. Optional. null by default. Allows UTXO's to be added from assets in the whitelist or the asset being sent
Param assetMap: Required. Description of Map:
  Index assetGuid. Required. Numeric Asset GUID you are sending to as string
  Value is described below:
    Field changeAddress. Optional. Where asset change outputs will be sent to. If it is not there or null a new change address will be created. If HDSigner is not set, it will send asset change outputs to sysChangeAddress
    Field outputs. Required. Array of objects described below:
      Field value. Required. Big Number representing satoshi's to send
      Field address. Required. Destination address for value.
  Example:
    const assetMap = new Map([
      [assetGuid, { outputs: [{ value: new BN(1000), address: 'tsys1qdflre2yd37qtpqe2ykuhwandlhq04r2td2t9ae' }] }]
    ])
    Would send 1000 satoshi to address 'tsys1qdflre2yd37qtpqe2ykuhwandlhq04r2td2t9ae' in asset 'assetGuid'
Param sysChangeAddress: Optional. Change address if defined is where Syscoin only change outputs are sent to. Does not apply to asset change outputs which are definable in the assetOpts object. If not defined and HDSigner is defined then a new change address will be automatically created using the next available change address index in the HD path
Param feeRate: Optional. Defaults to 10 satoshi per byte. How many satoshi per byte the network fee should be paid out as.
Param sysFromXpubOrAddress: Optional. If wanting to fund from a specific XPUB or address specify this field should be set
Param utxos: Optional. Pass in specific utxos to fund a transaction, should be sanitized using utils.sanitizeBlockbookUTXOs()
Returns: PSBT if if HDSigner is set or result object which is used to create PSBT and sign/send if xpub/address are passed in to fund transaction
*/
SyscoinJSLib.prototype.assetSend = async function (txOpts, assetMapIn, sysChangeAddress, feeRate, sysFromXpubOrAddress, utxos) {
  if (this.HDSigner) {
    if (!sysChangeAddress) {
      sysChangeAddress = await this.HDSigner.getNewChangeAddress()
    }
  }
  const BN_ZERO = new BN(0)
  const assetMap = new Map()
  // create new map with base ID's setting zero val output in the base asset outputs array
  for (const [assetGuid, valueAssetObj] of assetMapIn.entries()) {
    const baseAssetID = utils.getBaseAssetID(assetGuid)
    // if NFT
    if (baseAssetID !== assetGuid) {
      // likely NFT issuance only with no base value asset issued, create new base value object so assetSend can perform proof of ownership
      if (!assetMapIn.has(baseAssetID)) {
        const valueBaseAssetObj = { outputs: [{ address: sysChangeAddress, value: BN_ZERO }] }
        valueBaseAssetObj.changeAddress = sysChangeAddress
        assetMap.set(baseAssetID, valueBaseAssetObj)
      }
      assetMap.set(assetGuid, valueAssetObj)
    // regular FT
    } else {
      valueAssetObj.outputs.push({ address: sysChangeAddress, value: BN_ZERO })
      valueAssetObj.changeAddress = sysChangeAddress
      assetMap.set(assetGuid, valueAssetObj)
    }
  }
  if (this.HDSigner) {
    for (const valueAssetObj of assetMap.values()) {
      if (!valueAssetObj.changeAddress) {
        valueAssetObj.changeAddress = await this.HDSigner.getNewChangeAddress()
      }
    }
  }
  // true last param for filtering out 0 conf UTXO, new/update/send asset transactions must use confirmed inputs only as per Syscoin Core mempool policy
  utxos = await this.fetchAndSanitizeUTXOs(utxos, sysFromXpubOrAddress, txOpts, assetMap, true)
  const res = syscointx.assetSend(txOpts, utxos, assetMap, sysChangeAddress, feeRate)
  const psbt = await this.HDSigner.createPSBTFromRes(res)
  if (sysFromXpubOrAddress) {
    return { psbt: psbt, res: psbt, assets: utils.getAssetsRequiringNotarization(psbt, utxos.assets) }
  }
  return await this.signAndSend(psbt, utils.getAssetsRequiringNotarization(psbt, utxos.assets))
}

/* assetAllocationSend
Purpose: Send an asset allocations to other users.
Param txOpts: Optional. Transaction options. Fields are described below:
  Field rbf. Optional. True by default. Replace-by-fee functionality allowing one to bump transaction by increasing fee for UTXOs used.
  Field assetWhiteList. Optional. null by default. Allows UTXO's to be added from assets in the whitelist or the asset being sent
  Field memo. Optional. An optional data carrying byte field to include in the transaction.
  Field memoHeader. Optional. Header that prefixes memo field, memo + memoHeader is max 80 bytes
Param assetMap: Required. Description of Map:
  Index assetGuid. Required. Numeric Asset GUID you are sending to
  Value is described below:
    Field changeAddress. Optional. Where asset change outputs will be sent to. If it is not there or null a new change address will be created. If HDSigner is not set, it will send asset change outputs to sysChangeAddress
    Field outputs. Required. Array of objects described below:
      Field value. Required. Big Number representing satoshi's to send
      Field address. Required. Destination address for value.
  Example:
    const assetMap = new Map([
      [assetGuid, { outputs: [{ value: new BN(1000), address: 'tsys1qdflre2yd37qtpqe2ykuhwandlhq04r2td2t9ae' }] }]
    ])
    Would send 1000 satoshi to address 'tsys1qdflre2yd37qtpqe2ykuhwandlhq04r2td2t9ae' in asset 'assetGuid'
Param sysChangeAddress: Optional. Change address if defined is where Syscoin only change outputs are sent to. Does not apply to asset change outputs which are definable in the assetOpts object. If not defined and HDSigner is defined then a new change address will be automatically created using the next available change address index in the HD path
Param feeRate: Optional. Defaults to 10 satoshi per byte. How many satoshi per byte the network fee should be paid out as.
Param sysFromXpubOrAddress: Optional. If wanting to fund from a specific XPUB or address specify this field should be set
Param utxos: Optional. Pass in specific utxos to fund a transaction, should be sanitized using utils.sanitizeBlockbookUTXOs()
Returns: PSBT if if HDSigner is set or result object which is used to create PSBT and sign/send if xpub/address are passed in to fund transaction
*/
SyscoinJSLib.prototype.assetAllocationSend = async function (txOpts, assetMap, sysChangeAddress, feeRate, sysFromXpubOrAddress, utxos) {
  if (this.HDSigner) {
    for (const valueAssetObj of assetMap.values()) {
      if (!valueAssetObj.changeAddress) {
        valueAssetObj.changeAddress = await this.HDSigner.getNewChangeAddress()
      }
    }
    if (!sysChangeAddress) {
      sysChangeAddress = await this.HDSigner.getNewChangeAddress()
    }
  }
  // true last param for filtering out 0 conf UTXO, new/update/send asset transactions must use confirmed inputs only as per Syscoin Core mempool policy
  utxos = await this.fetchAndSanitizeUTXOs(utxos, sysFromXpubOrAddress, txOpts, assetMap, true)
  const res = syscointx.assetAllocationSend(txOpts, utxos, assetMap, sysChangeAddress, feeRate)
  const psbt = await this.HDSigner.createPSBTFromRes(res)
  if (sysFromXpubOrAddress) {
    return { psbt: psbt, res: psbt, assets: utils.getAssetsRequiringNotarization(psbt, utxos.assets) }
  }
  return await this.signAndSend(psbt, utils.getAssetsRequiringNotarization(psbt, utxos.assets))
}

/* assetAllocationBurn
Purpose: Burn an asset allocation for purpose of provably burning. Could be used to create proof-of-burn for SysEthereum bridge by specifying the ethaddress as destination in assetOpts.
Param assetOpts: Optional. Fields described below:
  Field ethaddress. Optional. If burning for purpose of sending over SysEthereum bridge specify the destination Ethereum address where tokens should be sent to on Ethereum.
Param txOpts: Optional. Transaction options. Fields are described below:
  Field rbf. Optional. True by default. Replace-by-fee functionality allowing one to bump transaction by increasing fee for UTXOs used.
  Field assetWhiteList. Optional. null by default. Allows UTXO's to be added from assets in the whitelist or the asset being sent
Param assetMap: Required. Description of Map:
  Index assetGuid. Required. Numeric Asset GUID you are sending to
  Value is described below:
    Field changeAddress. Optional. Where asset change outputs will be sent to. If it is not there or null a new change address will be created. If HDSigner is not set, it will send asset change outputs to sysChangeAddress
    Field outputs. Required. Array of objects described below:
      Field value. Required. Big Number representing satoshi's to burn
  Example:
    const assetMap = new Map([
      [assetGuid, { outputs: [{ value: new BN(1000) }] }]
    ])
    Would burn 1000 satoshi in asset 'assetGuid'
Param sysChangeAddress: Optional. Change address if defined is where Syscoin only change outputs are sent to. Does not apply to asset change outputs which are definable in the assetOpts object. If not defined and HDSigner is defined then a new change address will be automatically created using the next available change address index in the HD path
Param feeRate: Optional. Defaults to 10 satoshi per byte. How many satoshi per byte the network fee should be paid out as.
Param sysFromXpubOrAddress: Optional. If wanting to fund from a specific XPUB or address specify this field should be set
Param utxos: Optional. Pass in specific utxos to fund a transaction, should be sanitized using utils.sanitizeBlockbookUTXOs()
Returns: PSBT if if HDSigner is set or result object which is used to create PSBT and sign/send if xpub/address are passed in to fund transaction
*/
SyscoinJSLib.prototype.assetAllocationBurn = async function (assetOpts, txOpts, assetMap, sysChangeAddress, feeRate, sysFromXpubOrAddress, utxos) {
  if (this.HDSigner) {
    if (!sysChangeAddress) {
      sysChangeAddress = await this.HDSigner.getNewChangeAddress()
    }
    for (const valueAssetObj of assetMap.values()) {
      if (!valueAssetObj.changeAddress) {
        valueAssetObj.changeAddress = await this.HDSigner.getNewChangeAddress()
      }
    }
  }
  // true last param for filtering out 0 conf UTXO, new/update/send asset transactions must use confirmed inputs only as per Syscoin Core mempool policy
  utxos = await this.fetchAndSanitizeUTXOs(utxos, sysFromXpubOrAddress, txOpts, assetMap, true)
  const res = syscointx.assetAllocationBurn(assetOpts, txOpts, utxos, assetMap, sysChangeAddress, feeRate)
  const psbt = await this.HDSigner.createPSBTFromRes(res)
  if (sysFromXpubOrAddress) {
    return { psbt: psbt, res: psbt, assets: utils.getAssetsRequiringNotarization(psbt, utxos.assets) }
  }
  return await this.signAndSend(psbt, utils.getAssetsRequiringNotarization(psbt, utxos.assets))
}

/* assetAllocationMint
Purpose: Minting new asset using proof-of-lock on Ethereum as a proof to mint tokens on Syscoin.
Param assetOpts: Optional. If you have the Ethereum TXID and want to use eth-proof you can just specify the ethtxid and infuraurl fields. Fields described below:
  Field ethtxid. Optional. If using eth-proof specify Ethereum proof-of-lock txid on Ethereum. The trasaction that calls freezeBurnERC20() on ERC20Manager contract
  Field infuraurl. Optional. Fully qualified Infura API URL including Infura ID for web3 access that eth-proof needs to obtain the tx proof and receipt proof information needed by Syscoin to valdiate the mint
  Field bridgetransferid. Optional. If ethtxid or infuraurl is not provided, manually enter proof info. Bridge transfer ID is the unique counter of locks on Ethereum. The freezeBurnERC20() emits a log that includes the unique ID which is entered here.
  Field blocknumber. Optional. Block number of transaction including freezeBurnERC20() call
  Field txvalue. Optional. Buffer value of the transaction hex encoded in RLP format
  Field txroot. Optional. Buffer value of the transaction merkle root encoded in RLP format
  Field txparentnodes. Optional. Buffer value of the transaction merkle proof encoded in RLP format
  Field txpath. Optional. Buffer value of the merkle path for the transaction and receipt proof
  Field receiptvalue. Optional. Buffer value of the transaction receipt hex encoded in RLP format
  Field receiptroot. Optional. Buffer value of the receipt merkle root encoded in RLP format
  Field receiptparentnodes. Optional. Buffer value of the receipt merkle proof encoded in RLP format
Param txOpts: Optional. Transaction options. Fields are described below:
  Field rbf. Optional. True by default. Replace-by-fee functionality allowing one to bump transaction by increasing fee for UTXOs used.
  Field assetWhiteList. Optional. null by default. Allows UTXO's to be added from assets in the whitelist or the asset being sent
Param assetMap: Optional. Auto-filled by eth-proof if it is used (pass ethtxid and infuraurl in assetOpts). Description of Map:
  Index assetGuid. Required. Numeric Asset GUID you are sending to
  Value is described below:
    Field changeAddress. Optional. Where asset change outputs will be sent to. If it is not there or null a new change address will be created. If HDSigner is not set, it will send asset change outputs to sysChangeAddress
    Field outputs. Required. Array of objects described below:
      Field value. Required. Big Number representing satoshi's to mint
  Example:
    const assetMap = new Map([
      [assetGuid, { outputs: [{ value: new BN(1000), address: 'tsys1qdflre2yd37qtpqe2ykuhwandlhq04r2td2t9ae' }] }]
    ])
    Would mint 1000 satoshi to address 'tsys1qdflre2yd37qtpqe2ykuhwandlhq04r2td2t9ae' in asset 'assetGuid'
Param sysChangeAddress: Optional. Change address if defined is where Syscoin only change outputs are sent to. Does not apply to asset change outputs which are definable in the assetOpts object. If not defined and HDSigner is defined then a new change address will be automatically created using the next available change address index in the HD path
Param feeRate: Optional. Defaults to 10 satoshi per byte. How many satoshi per byte the network fee should be paid out as.
Param sysFromXpubOrAddress: Optional. If wanting to fund from a specific XPUB or address specify this field should be set
Param utxos: Optional. Pass in specific utxos to fund a transaction, should be sanitized using utils.sanitizeBlockbookUTXOs()
Returns: PSBT if if HDSigner is set or result object which is used to create PSBT and sign/send if xpub/address are passed in to fund transaction
*/
SyscoinJSLib.prototype.assetAllocationMint = async function (assetOpts, txOpts, assetMap, sysChangeAddress, feeRate, sysFromXpubOrAddress, utxos) {
  if (this.HDSigner) {
    if (assetMap) {
      for (const valueAssetObj of assetMap.values()) {
        if (!valueAssetObj.changeAddress) {
          valueAssetObj.changeAddress = await this.HDSigner.getNewChangeAddress()
        }
      }
    }
    if (!sysChangeAddress) {
      sysChangeAddress = await this.HDSigner.getNewChangeAddress()
    }
  }
  if (!assetMap) {
    const ethProof = await utils.buildEthProof(assetOpts)
    let changeAddress
    if (this.HDSigner) {
      changeAddress = await this.HDSigner.getNewChangeAddress()
    }
    assetMap = new Map([
      [ethProof.assetguid, { changeAddress: changeAddress, outputs: [{ value: new BN(ethProof.amount), address: ethProof.destinationaddress }] }]
    ])
    assetOpts = {
      bridgetransferid: ethProof.bridgetransferid,
      blocknumber: ethProof.blocknumber,
      txvalue: Buffer.from(ethProof.txvalue, 'hex'),
      txroot: Buffer.from(ethProof.txroot, 'hex'),
      txparentnodes: Buffer.from(ethProof.txparentnodes, 'hex'),
      txpath: Buffer.from(ethProof.txpath, 'hex'),
      receiptvalue: Buffer.from(ethProof.receiptvalue, 'hex'),
      receiptroot: Buffer.from(ethProof.receiptroot, 'hex'),
      receiptparentnodes: Buffer.from(ethProof.receiptparentnodes, 'hex')
    }
  }

  // true last param for filtering out 0 conf UTXO, new/update/send asset transactions must use confirmed inputs only as per Syscoin Core mempool policy
  utxos = await this.fetchAndSanitizeUTXOs(utxos, sysFromXpubOrAddress, txOpts, assetMap, true)
  const res = syscointx.assetAllocationMint(assetOpts, txOpts, utxos, assetMap, sysChangeAddress, feeRate)
  const psbt = await this.HDSigner.createPSBTFromRes(res)
  if (sysFromXpubOrAddress) {
    return { psbt: psbt, res: psbt, assets: utils.getAssetsRequiringNotarization(psbt, utxos.assets) }
  }
  return await this.signAndSend(psbt, utils.getAssetsRequiringNotarization(psbt, utxos.assets))
}

/* syscoinBurnToAssetAllocation
Purpose: Burn Syscoin to mint SYSX
Param txOpts: Optional. Transaction options. Fields are described below:
  Field rbf. Optional. True by default. Replace-by-fee functionality allowing one to bump transaction by increasing fee for UTXOs used.
  Field assetWhiteList. Optional. null by default. Allows UTXO's to be added from assets in the whitelist or the asset being sent
Param assetMap: Required. Description of Map:
  Index assetGuid. Required. Numeric Asset GUID you are sending to
  Value is described below:
    Field changeAddress. Optional. Where asset change outputs will be sent to. If it is not there or null a new change address will be created. If HDSigner is not set, it will send asset change outputs to sysChangeAddress
    Field outputs. Required. Array of objects described below:
      Field value. Required. Big Number representing satoshi's to mint
  Example:
    const assetMap = new Map([
      [assetGuid, { outputs: [{ value: new BN(1000), address: 'tsys1qdflre2yd37qtpqe2ykuhwandlhq04r2td2t9ae' }] }]
    ])
    Would mint 1000 satoshi to address 'tsys1qdflre2yd37qtpqe2ykuhwandlhq04r2td2t9ae' in asset 'assetGuid'.
    Would also end up burning 1000 SYS satoshi to OP_RETURN output
Param sysChangeAddress: Optional. Change address if defined is where Syscoin only change outputs are sent to. Does not apply to asset change outputs which are definable in the assetOpts object. If not defined and HDSigner is defined then a new change address will be automatically created using the next available change address index in the HD path
Param feeRate: Optional. Defaults to 10 satoshi per byte. How many satoshi per byte the network fee should be paid out as.
Param sysFromXpubOrAddress: Optional. If wanting to fund from a specific XPUB or address specify this field should be set
Param utxos: Optional. Pass in specific utxos to fund a transaction, should be sanitized using utils.sanitizeBlockbookUTXOs()
Returns: PSBT if if HDSigner is set or result object which is used to create PSBT and sign/send if xpub/address are passed in to fund transaction
*/
SyscoinJSLib.prototype.syscoinBurnToAssetAllocation = async function (txOpts, assetMap, sysChangeAddress, feeRate, sysFromXpubOrAddress, utxos) {
  if (this.HDSigner) {
    for (const valueAssetObj of assetMap.values()) {
      if (!valueAssetObj.changeAddress) {
        valueAssetObj.changeAddress = await this.HDSigner.getNewChangeAddress()
      }
    }
    if (!sysChangeAddress) {
      sysChangeAddress = await this.HDSigner.getNewChangeAddress()
    }
  }
  // true last param for filtering out 0 conf UTXO, new/update/send asset transactions must use confirmed inputs only as per Syscoin Core mempool policy
  utxos = await this.fetchAndSanitizeUTXOs(utxos, sysFromXpubOrAddress, txOpts, assetMap, true)
  const res = syscointx.syscoinBurnToAssetAllocation(txOpts, utxos, assetMap, sysChangeAddress, feeRate)
  const psbt = await this.HDSigner.createPSBTFromRes(res)
  if (sysFromXpubOrAddress) {
    return { psbt: psbt, res: psbt, assets: utils.getAssetsRequiringNotarization(psbt, utxos.assets) }
  }
  return await this.signAndSend(psbt, utils.getAssetsRequiringNotarization(psbt, utxos.assets))
}

module.exports = {
  SyscoinJSLib: SyscoinJSLib,
  utils: utils
}
