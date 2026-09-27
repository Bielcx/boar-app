Pod::Spec.new do |s|
  s.name           = 'FileHash'
  s.version        = '0.1.0'
  # Self-contained (no ../package.json): this ios/ dir can land before the
  # module's JS side, and pod install must not break in between.
  s.summary        = 'Streaming SHA-256 of large files without loading them into JS memory.'
  s.license        = 'MIT'
  s.authors        = 'BOAR'
  s.homepage       = 'https://github.com/rferrari/boar-app'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,swift}'
end
