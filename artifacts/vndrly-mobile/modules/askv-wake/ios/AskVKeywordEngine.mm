#import "AskVKeywordEngine.h"
#include "sherpa-onnx/c-api/c-api.h"
#include <exception>

@implementation AskVKeywordEngine {
  const SherpaOnnxKeywordSpotter *_spotter;
  const SherpaOnnxOnlineStream *_stream;
}

- (nullable instancetype)initWithModelDirectory:(NSString *)directory error:(NSError **)error {
  self = [super init];
  if (!self) return nil;
  NSArray<NSString *> *names = @[@"encoder.onnx", @"decoder.onnx", @"joiner.onnx", @"tokens.txt", @"keywords.txt"];
  NSMutableArray<NSString *> *paths = [NSMutableArray arrayWithCapacity:names.count];
  for (NSString *name in names) {
    NSString *path = [directory stringByAppendingPathComponent:name];
    if (![[NSFileManager defaultManager] isReadableFileAtPath:path]) {
      if (error) *error = [NSError errorWithDomain:@"AskVWake" code:1
        userInfo:@{NSLocalizedDescriptionKey: @"Wake model files are missing."}];
      return nil;
    }
    [paths addObject:path];
  }

  // The v1.12.29 C API copies these paths during construction.
  SherpaOnnxKeywordSpotterConfig config = {};
  config.feat_config.sample_rate = 16000;
  config.feat_config.feature_dim = 80;
  config.model_config.transducer.encoder = paths[0].UTF8String;
  config.model_config.transducer.decoder = paths[1].UTF8String;
  config.model_config.transducer.joiner = paths[2].UTF8String;
  config.model_config.tokens = paths[3].UTF8String;
  config.model_config.num_threads = 1;
  config.model_config.provider = "cpu";
  config.model_config.model_type = "zipformer2";
  config.model_config.debug = 0;
  config.max_active_paths = 4;
  config.num_trailing_blanks = 1;
  config.keywords_score = 1.0f;
  config.keywords_threshold = 0.25f;
  config.keywords_file = paths[4].UTF8String;
  try {
    _spotter = SherpaOnnxCreateKeywordSpotter(&config);
    if (_spotter) _stream = SherpaOnnxCreateKeywordStream(_spotter);
  } catch (const std::exception &) {
    // Keep paths, model diagnostics and audio out of the event bridge/logs.
  }
  if (!_spotter || !_stream) {
    if (error) *error = [NSError errorWithDomain:@"AskVWake" code:2
      userInfo:@{NSLocalizedDescriptionKey: @"Unable to initialize the local keyword engine."}];
    return nil;
  }
  return self;
}

- (nullable NSString *)acceptSamples:(const float *)samples count:(int32_t)count error:(NSError **)error {
  if (!_spotter || !_stream || count <= 0) return @"";
  try {
    SherpaOnnxOnlineStreamAcceptWaveform(_stream, 16000, samples, count);
    while (SherpaOnnxIsKeywordStreamReady(_spotter, _stream)) {
      SherpaOnnxDecodeKeywordStream(_spotter, _stream);
      const SherpaOnnxKeywordResult *result = SherpaOnnxGetKeywordResult(_spotter, _stream);
      NSString *keyword = nil;
      if (result && result->keyword && result->keyword[0]) {
        keyword = [NSString stringWithUTF8String:result->keyword];
      }
      if (result) SherpaOnnxDestroyKeywordResult(result);
      if (keyword.length > 0) {
        SherpaOnnxResetKeywordStream(_spotter, _stream);
        return keyword;
      }
    }
    // NSError-imported Swift methods treat nil as failure, so no detection is
    // an empty string. Only an actual exception returns nil with an NSError.
    return @"";
  } catch (...) {
    if (error) *error = [NSError errorWithDomain:@"AskVWake" code:3
      userInfo:@{NSLocalizedDescriptionKey: @"The local keyword engine stopped."}];
    return nil;
  }
}

- (BOOL)reset {
  // A new stream discards acoustic history from the spoken reply.
  if (_stream) SherpaOnnxDestroyOnlineStream(_stream);
  _stream = nullptr;
  try {
    _stream = _spotter ? SherpaOnnxCreateKeywordStream(_spotter) : nullptr;
  } catch (...) {
    return NO;
  }
  return _stream != nullptr;
}

- (void)dealloc {
  if (_stream) SherpaOnnxDestroyOnlineStream(_stream);
  if (_spotter) SherpaOnnxDestroyKeywordSpotter(_spotter);
}
@end
