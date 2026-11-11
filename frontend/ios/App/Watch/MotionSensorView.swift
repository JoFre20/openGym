import SwiftUI

/// Shown when the iPhone uses this Watch as a pure motion sensor. The Watch only reports status;
/// the count is on the phone. A stop button is here because the Watch may be strapped to a machine
/// where the phone is not within reach of its screen.
struct MotionSensorView: View {
    @EnvironmentObject var store: SessionStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 8) {
            Text("Watch sensor")
                .font(.system(.headline, design: .rounded))
            ZStack {
                Circle()
                    .fill(store.motionActive ? Theme.accent : Theme.dim)
                    .frame(width: 14, height: 14)
                    .shadow(color: store.motionActive ? Theme.accent.opacity(0.45) : .clear, radius: 8)
                if !store.motionActive {
                    Image(systemName: "pause.fill")
                        .font(.system(size: 7, weight: .bold))
                        .foregroundStyle(.white)
                }
            }
            Text(store.motionActive ? LocalizedStringKey("Sensor active") : LocalizedStringKey("Sensor stopped"))
                .font(.footnote.weight(.semibold))
            Text("The iPhone counts. This Watch only sends movement.")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .minimumScaleFactor(0.75)
            if let error = store.motionError, !store.motionActive {
                Text(error == "unavailable" ? LocalizedStringKey("The motion sensor is not available.") : LocalizedStringKey("The sensor stopped. Try again."))
                    .font(.caption2)
                    .foregroundStyle(Theme.warmup)
                    .multilineTextAlignment(.center)
            }
            Spacer(minLength: 4)
            Button {
                store.stopMotionSensor()
                dismiss()
            } label: {
                Text("Stop")
                    .frame(maxWidth: .infinity, minHeight: Theme.tap)
                    .background(Capsule().fill(Theme.dim))
            }
            .buttonStyle(.plain)
            .disabled(!store.motionActive)
        }
        .padding(.horizontal, 4)
        // Closing the sheet does not stop a sensor the phone may still need. The phone's Stop
        // and the app leaving the foreground do. Keep this screen's own close passive.
    }
}
