import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var library: FlowLibrary
    @State private var selection: FlowLibrary.Flow?
    @State private var renaming: FlowLibrary.Flow?
    @State private var newName = ""

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                ForEach(library.flows) { flow in
                    NavigationLink(value: flow) {
                        Label(flow.name, systemImage: "point.3.connected.trianglepath.dotted")
                    }
                    .contextMenu {
                        Button {
                            newName = flow.name
                            renaming = flow
                        } label: {
                            Label("Rename", systemImage: "pencil")
                        }
                        Button(role: .destructive) {
                            delete(flow)
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
                .onDelete { offsets in
                    offsets.map { library.flows[$0] }.forEach(delete)
                }
            }
            .navigationTitle("Flows")
            .toolbar {
                Button {
                    selection = library.create()
                } label: {
                    Label("New Flow", systemImage: "plus")
                }
            }
            .overlay {
                if library.flows.isEmpty {
                    VStack(spacing: 8) {
                        Text("No flows yet").font(.headline)
                        Text("Tap + to create one.").foregroundStyle(.secondary)
                    }
                }
            }
        } detail: {
            if let flow = selection {
                EditorScreen(flow: flow)
                    .id(flow)
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "point.3.connected.trianglepath.dotted")
                        .font(.system(size: 48))
                        .foregroundStyle(.secondary)
                    Text("Create or pick a flow")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .alert("Rename Flow", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $newName)
            Button("Cancel", role: .cancel) { renaming = nil }
            Button("Rename") {
                if let flow = renaming {
                    let renamed = library.rename(flow, to: newName)

                    if selection == flow {
                        selection = renamed
                    }
                }

                renaming = nil
            }
        }
    }

    private func delete(_ flow: FlowLibrary.Flow) {
        if selection == flow {
            selection = nil
        }

        library.delete(flow)
    }
}
