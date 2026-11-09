# Adds the UI test target (ios/App/AppUITests) and a scheme for it to App.xcodeproj. The committed
# project contains them, so CI's call only reports that they are already there; the script is kept
# so a regenerated Capacitor project gets them back. Uses the xcodeproj gem that ships with
# CocoaPods.
require 'xcodeproj'

dir = File.expand_path('../App', __dir__)
proj = Xcodeproj::Project.open(File.join(dir, 'App.xcodeproj'))
app = proj.targets.find { |t| t.name == 'App' }
abort 'no App target' unless app
if proj.targets.any? { |t| t.name == 'AppUITests' }
  puts 'AppUITests is already in the project'
  exit 0
end
tests = proj.new_target(:ui_test_bundle, 'AppUITests', :ios, '15.5')
tests.add_dependency(app)
group = proj.main_group.new_group('AppUITests', 'AppUITests')
tests.add_file_references([group.new_file('OpenGymUITests.swift')])
tests.build_configurations.each do |c|
  s = c.build_settings
  s['TEST_TARGET_NAME'] = 'App'
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['PRODUCT_BUNDLE_IDENTIFIER'] = 'hb.opengym.app.uitests'
  s['SWIFT_VERSION'] = '5.0'
  s['GENERATE_INFOPLIST_FILE'] = 'YES'
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['CODE_SIGN_STYLE'] = 'Automatic'
end
proj.save

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.set_launch_target(app)
scheme.add_test_target(tests)
scheme.save_as(File.join(dir, 'App.xcodeproj'), 'AppUITests', true)
puts 'added AppUITests'
