const Uuid = require('hat')
const extend = require('xtend')
const crypto = require('crypto')
const ethUtil = require('ethereumjs-util')
const async = require('async')
const semaphore = require('semaphore')

const binaryEncoding = 'base64'
const keyStoragePrefix = 'key-'


module.exports = function(storage) {

  var keyIndex = null
  var lock = semaphore(1)
  lock.leave = lock.leave.bind(lock)

  var apiObject = {
    lookupAll: lookupAll,
    generateIdentity: generateIdentity,
    importIdentity: importIdentity,
    exportIdentity: exportIdentity,
    exportAll: exportAll,
  }

  // lock until keyIndex is loaded
  lock.take(function(){
    loadKeyIndex(lock.leave)
  })
  
  return apiObject

  // public

  // asynchronously returns safeKeyData for all keys
  function lookupAll(cb){
    ensureUnlocked(function(){
      async.map(keyIndex, getSafeKey, cb)
    })
  }

  function generateIdentity(opts, cb) {
    ensureUnlocked(function(){
      importIdentity({
        label: opts.label,
        privateKey: crypto.randomBytes(32),
      }, cb)
    })
  }

  // opts.privateKey should be a buffer
  function importIdentity(opts, cb) {
    var privateKey = opts.privateKey
    var publicKey = ethUtil.privateToPublic(privateKey)
    var address = ethUtil.publicToAddress(publicKey)

    var keyPair = {
      id: Uuid(),
      label: opts.label,
      privateKey: privateKey,
      publicKey: publicKey,
      address: address,
    }
    var keyObj = KeyObject(keyPair)

    ensureUnlocked(function(){

      appendToKeyIndex(keyPair.id)
      storeKey(keyPair, function(err){
        if (err) return cb(err)
        cb(null, keyObj)
      })

    })

    return keyObj

  }

  function exportIdentity(keyId, cb) {
    ensureUnlocked(function(){
      getKey(keyId, cb)
    })
  }

  function exportAll(cb) {
    ensureUnlocked(function(){
      async.map(keyIndex, getKey, cb)
    })
  }

  // private

  function KeyObject(data) {
    var id = data.id
    return {
      // properties
      label: data.label,
      address: data.address.toString('hex'),
      // methods
      signTx: signTx.bind(null, id),
    }
  }

  function getSafeKey(keyId, cb){
    lookupKey(keyId, function(err, data){
      if (err) return cb(err)
      cb(null, KeyObject(data))
    })
  }

  function signTx(keyId, tx, cb){
    lookupKey(keyId, function(err, data){
      if (err) return cb(err)
      try {
        var privateKey = new Buffer(data.privateKey, 'hex')
        tx.sign(privateKey)
        cb(null, tx)
      } catch (err) {
        if (err) return cb(err)
      }
    })
  }

  function lookupKey(keyId, cb) {
    getKey(keyId, function(err, data){
      if (err) return cb(err)
      cb(null, deserializeKey(data))
    })
  }

  function storeKey(key, cb) {
    putKey(key.id, serializeKey(key), cb)
  }

  function getKey(keyId, cb) {
    storage.get(keyStoragePrefix+keyId, cb)
  }

  function putKey(keyId, data, cb) {
    storage.put(keyStoragePrefix+keyId, data, cb)
  }

  function serializeKey(key) {
    var data = extend(key)
    data.privateKey = key.privateKey.toString(binaryEncoding)
    data.publicKey = key.publicKey.toString(binaryEncoding)
    data.address = key.address.toString(binaryEncoding)
    return JSON.stringify(data)
  }

  function deserializeKey(data) {
    var key = JSON.parse(data)
    key.privateKey = Buffer(key.privateKey, binaryEncoding)
    key.publicKey = Buffer(key.publicKey, binaryEncoding)
    key.address = Buffer(key.address, binaryEncoding)
    return key
  }

  function appendToKeyIndex(id){
    keyIndex.push(id)
    updateKeyIndex()
  }

  function updateKeyIndex(){
    storage.put('keyIndex', JSON.stringify(keyIndex), function noop(){})
  }

  function loadKeyIndex(cb){
    storage.get('keyIndex', function(err, data){
      if (err || !data) {
        keyIndex = []
      } else {
        keyIndex = JSON.parse(data)
      }
      cb()
    })
  }

  // util

  function ensureUnlocked(cb){
    lock.take(function(){
      lock.leave()
      cb()
    })
  }

}