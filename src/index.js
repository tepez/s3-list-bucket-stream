const { Readable } = require('readable-stream')

const defaultOptions = {
  fullMetadata: false
}

const defaultListObjectsV2Options = {
  maxKeys: 1000
}

class S3ListBucketStream extends Readable {
  constructor (s3, bucket, bucketPrefix, options = {}, listObjectsV2args = {}) {
    const mergedOptions = Object.assign({}, defaultOptions, options)

    // forces object mode if full metadata is enabled
    if (mergedOptions.fullMetadata) {
      mergedOptions.objectMode = true
    }

    // invoke parent constructor
    super(mergedOptions)

    // config
    this._s3 = s3
    this._bucket = bucket
    this._bucketPrefix = bucketPrefix
    this._fullMetadata = mergedOptions.fullMetadata
    this._listObjectsV2args = Object.assign({}, defaultListObjectsV2Options, listObjectsV2args)

    // internal state
    this._lastResponse = undefined
    this._currentIndex = undefined
    this._stopped = true
  }

  _loadNextPage () {
    return new Promise((resolve, reject) => {
      const currentParams = {
        Bucket: this._bucket,
        Prefix: this._bucketPrefix,
        ContinuationToken: this._lastResponse
          ? this._lastResponse.NextContinuationToken
          : undefined
      }

      const params = Object.assign({}, this._listObjectsV2args, currentParams)

      this._s3.listObjectsV2(params, (err, data) => {
        if (err) {
          return reject(err)
        }

        this._lastResponse = data
        this._currentIndex = 0

        this.emit('page', { params, data })
        return resolve()
      })
    })
  }

  async _startRead () {
    try {
      this._stopped = false
      this.emit('restarted', true)
      while (true) {
        if (
          typeof this._lastResponse === 'undefined' ||
          this._currentIndex >= this._lastResponse.Contents.length
        ) {
          if (this._lastResponse && !this._lastResponse.IsTruncated) {
            return this.push(null) // stream is over
          }
          await this._loadNextPage()
        }

        let chunkToPush = this._lastResponse.Contents[this._currentIndex++]
        if (!this._fullMetadata) {
          // return only the object key (file name)
          chunkToPush = chunkToPush.Key
        }

        if (!this.push(chunkToPush)) {
          this._stopped = true
          this.emit('stopped', true)
          break // reader buffer full, stop until next _read call
        }
      }
    } catch (err) {
      return this.emit('error', err)
    }
  }

  _read (size) {
    if (this._stopped) {
      // if stopped, restart reading from the source S3 api
      this._startRead()
    }
  }
}

module.exports = S3ListBucketStream
