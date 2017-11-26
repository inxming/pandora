'use strict';
import { Patcher } from 'pandora-metrics';

export class UrllibPatcher extends Patcher {

  constructor() {
    super();

    this.shimmer();
  }

  getModuleName() {
    return 'urllib';
  }

  buildTags(url, args) {

    return {
      'http.method': {
        value: (args.method || 'GET').toLowerCase(),
        type: 'string'
      },
      'http.url': {
        value: url,
        type: 'string'
      },
      'http.client': {
        value: true,
        type: 'bool'
      }
    };
  }

  createSpan(tracer, tags) {
    let span;
    const currentSpan = tracer.getCurrentSpan();

    if (currentSpan) {
      const traceId = tracer.getAttr('traceId');

      span = tracer.startSpan('urllib', {
        childOf: currentSpan,
        traceId
      });
    }

    if (span) {
      span.addTags(tags);
    }

    return span;
  }

  shimmer() {
    const self = this;
    const traceManager = this.getTraceManager();

    this.hook('^2.x', (loadModule) => {

      const urllib = loadModule('lib/urllib');

      this.getShimmer().wrap(urllib, 'requestWithCallback', function wrapRequestWithCallback(request) {

        return function wrappedRequestWithCallback(url, args, callback) {

          if (arguments.length === 2 && typeof args === 'function') {
            callback = args;
            args = null;
          }

          args = args || {};
          const tracer = traceManager.getCurrentTracer();

          if (tracer) {
            const tags = self.buildTags(url, args);
            const span = self.createSpan(tracer, tags);

            if (!span) {
              return request.call(this, url, args, callback);
            }

            return request.call(this, url, args, function(err, data, res) {
              tracer.setCurrentSpan(span);

              span.setTag('error', {
                type: 'bool',
                value: !!err
              });

              span.setTag('http.status_code', {
                type: 'number',
                value: res.statusCode
              });

              span.finish();

              callback(err, data, res);
            });
          }

          return request.call(this, url, args, callback);
        };
      });
    });
  }
}
