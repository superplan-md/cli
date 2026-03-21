use std::{
    collections::HashSet,
    env, fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use tauri::Manager;

#[cfg(target_os = "macos")]
use tauri_nspanel::{
    tauri_panel, CollectionBehavior, ManagerExt as PanelManagerExt, PanelLevel, StyleMask,
    WebviewWindowExt,
};

fn overlay_runtime_file_path_for_workspace(workspace_root: &Path, file_name: &str) -> PathBuf {
    workspace_root.join(".superplan/runtime").join(file_name)
}

fn overlay_runtime_dir_for_workspace(workspace_root: &Path) -> PathBuf {
    workspace_root.join(".superplan/runtime")
}

#[derive(Default)]
struct OverlayWorkspaceState {
    workspace_root: Mutex<Option<PathBuf>>,
}

impl OverlayWorkspaceState {
    fn get(&self) -> Option<PathBuf> {
        self.workspace_root
            .lock()
            .expect("overlay workspace state mutex poisoned")
            .clone()
    }

    fn set(&self, workspace_root: Option<PathBuf>) {
        *self
            .workspace_root
            .lock()
            .expect("overlay workspace state mutex poisoned") = workspace_root;
    }
}

fn find_workspace_root(candidate: &Path) -> Option<PathBuf> {
    candidate
        .ancestors()
        .find(|ancestor| ancestor.join(".superplan").is_dir())
        .map(Path::to_path_buf)
}

fn normalize_workspace_override(candidate: PathBuf) -> Option<PathBuf> {
    if candidate.as_os_str().is_empty() {
        return None;
    }

    let absolute_candidate = if candidate.is_absolute() {
        candidate
    } else {
        env::current_dir().ok()?.join(candidate)
    };

    Some(find_workspace_root(&absolute_candidate).unwrap_or(absolute_candidate))
}

fn parse_workspace_override_from_args(args: &[String]) -> Option<PathBuf> {
    let mut index = 0;

    while index < args.len() {
        let arg = &args[index];

        if let Some(value) = arg.strip_prefix("--workspace=") {
            return normalize_workspace_override(PathBuf::from(value));
        }

        if arg == "--workspace" {
            let value = args
                .get(index + 1)
                .filter(|next| !next.starts_with("--"))
                .map(PathBuf::from)?;
            return normalize_workspace_override(value);
        }

        index += 1;
    }

    None
}

fn resolve_launch_workspace_override(args: &[String], cwd: Option<&Path>) -> Option<PathBuf> {
    parse_workspace_override_from_args(args).or_else(|| cwd.and_then(find_workspace_root))
}

fn initialize_workspace_override(app: &tauri::App) {
    let args = env::args().collect::<Vec<_>>();
    let workspace_override = parse_workspace_override_from_args(&args).or_else(|| {
        env::var_os("SUPERPLAN_OVERLAY_WORKSPACE")
            .map(PathBuf::from)
            .and_then(normalize_workspace_override)
    });

    app.state::<OverlayWorkspaceState>().set(workspace_override);
}

fn apply_secondary_launch(
    app_handle: &tauri::AppHandle,
    args: &[String],
    cwd: Option<&Path>,
) -> Result<(), String> {
    if let Some(workspace_override) = resolve_launch_workspace_override(args, cwd) {
        app_handle
            .state::<OverlayWorkspaceState>()
            .set(Some(workspace_override));
    }

    apply_overlay_visibility(app_handle, true)?;

    #[cfg(not(target_os = "macos"))]
    {
        let window = app_handle
            .get_webview_window("main")
            .ok_or_else(|| "failed to access main overlay window".to_string())?;

        window
            .set_focus()
            .map_err(|error| format!("failed to focus main overlay window: {error}"))?;
    }

    Ok(())
}

#[tauri::command]
fn load_overlay_snapshot(app_handle: tauri::AppHandle) -> Result<String, String> {
    let snapshot_path = resolve_overlay_snapshot_path(&app_handle)?.ok_or_else(|| {
        "failed to locate .superplan/runtime/overlay.json from explicit launch workspace, SUPERPLAN_OVERLAY_WORKSPACE, current working directory, or app manifest ancestors".to_string()
    })?;

    fs::read_to_string(&snapshot_path).map_err(|error| {
        format!(
            "failed to read overlay snapshot at {}: {error}",
            snapshot_path.display()
        )
    })
}

#[tauri::command]
fn load_overlay_control_state(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    let control_path = match resolve_overlay_control_path(&app_handle)? {
        Some(path) => path,
        None => return Ok(None),
    };

    fs::read_to_string(&control_path)
        .map(Some)
        .map_err(|error| {
            format!(
                "failed to read overlay control state at {}: {error}",
                control_path.display()
            )
        })
}

fn candidate_workspace_roots<'a>(
    workspace_override: Option<&'a Path>,
    current_dir: &'a Path,
    manifest_dir: &'a Path,
) -> Vec<&'a Path> {
    workspace_override
        .into_iter()
        .chain(current_dir.ancestors())
        .chain(manifest_dir.ancestors())
        .collect()
}

fn resolve_runtime_file_path_from_sources(
    file_name: &str,
    workspace_override: Option<&Path>,
    current_dir: &Path,
    manifest_dir: &Path,
) -> Option<PathBuf> {
    let mut seen_roots = HashSet::new();

    for root in candidate_workspace_roots(workspace_override, current_dir, manifest_dir) {
        let root = root.to_path_buf();
        if !seen_roots.insert(root.clone()) {
            continue;
        }

        let runtime_file_path = overlay_runtime_file_path_for_workspace(root.as_path(), file_name);
        if runtime_file_path.is_file() {
            return Some(runtime_file_path);
        }
    }

    None
}

fn resolve_overlay_snapshot_path_from_sources(
    workspace_override: Option<&Path>,
    current_dir: &Path,
    manifest_dir: &Path,
) -> Option<PathBuf> {
    resolve_runtime_file_path_from_sources(
        "overlay.json",
        workspace_override,
        current_dir,
        manifest_dir,
    )
}

fn resolve_overlay_control_path_from_sources(
    workspace_override: Option<&Path>,
    current_dir: &Path,
    manifest_dir: &Path,
) -> Option<PathBuf> {
    resolve_runtime_file_path_from_sources(
        "overlay-control.json",
        workspace_override,
        current_dir,
        manifest_dir,
    )
}

fn resolve_runtime_context(
    app_handle: &tauri::AppHandle,
) -> Result<(Option<PathBuf>, PathBuf, PathBuf), String> {
    let current_dir = env::current_dir()
        .map_err(|error| format!("failed to determine current working directory: {error}"))?;
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_override = app_handle
        .state::<OverlayWorkspaceState>()
        .get()
        .or_else(|| {
            env::var_os("SUPERPLAN_OVERLAY_WORKSPACE")
                .map(PathBuf::from)
                .and_then(normalize_workspace_override)
        });

    Ok((workspace_override, current_dir, manifest_dir))
}

fn resolve_overlay_snapshot_path(app_handle: &tauri::AppHandle) -> Result<Option<PathBuf>, String> {
    let (workspace_override, current_dir, manifest_dir) = resolve_runtime_context(app_handle)?;

    Ok(resolve_overlay_snapshot_path_from_sources(
        workspace_override.as_deref(),
        current_dir.as_path(),
        manifest_dir.as_path(),
    ))
}

fn resolve_overlay_control_path(app_handle: &tauri::AppHandle) -> Result<Option<PathBuf>, String> {
    let (workspace_override, current_dir, manifest_dir) = resolve_runtime_context(app_handle)?;

    Ok(resolve_overlay_control_path_from_sources(
        workspace_override.as_deref(),
        current_dir.as_path(),
        manifest_dir.as_path(),
    ))
}

fn resolve_overlay_workspace_root(app_handle: &tauri::AppHandle) -> Result<Option<PathBuf>, String> {
    let (workspace_override, current_dir, manifest_dir) = resolve_runtime_context(app_handle)?;

    Ok(workspace_override
        .or_else(|| find_workspace_root(current_dir.as_path()))
        .or_else(|| find_workspace_root(manifest_dir.as_path())))
}

#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(OverlayPanel {
        config: {
            can_become_key_window: true,
            becomes_key_only_if_needed: true,
            is_floating_panel: true
        }
    })
}

#[cfg(target_os = "macos")]
fn overlay_panel_collection_behavior() -> CollectionBehavior {
    CollectionBehavior::new()
        .can_join_all_spaces()
        .full_screen_auxiliary()
}

#[cfg(target_os = "macos")]
fn overlay_panel_style_mask() -> StyleMask {
    StyleMask::empty().nonactivating_panel()
}

#[cfg(target_os = "macos")]
fn configure_macos_overlay_panel(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    let app_handle = window.app_handle();

    app_handle.set_activation_policy(tauri::ActivationPolicy::Accessory)?;
    app_handle.set_dock_visibility(false)?;

    let panel = window.to_panel::<OverlayPanel>()?;

    panel.set_level(PanelLevel::Floating.value());
    panel.set_style_mask(overlay_panel_style_mask().into());
    panel.set_collection_behavior(overlay_panel_collection_behavior().into());
    panel.set_becomes_key_only_if_needed(true);
    panel.set_hides_on_deactivate(false);
    panel.set_works_when_modal(true);
    window.with_webview(|webview| unsafe {
        let native_window: &tauri_nspanel::objc2_app_kit::NSWindow = &*webview.ns_window().cast();
        let background = tauri_nspanel::objc2_app_kit::NSColor::clearColor();
        native_window.setOpaque(false);
        native_window.setHasShadow(false);
        native_window.setBackgroundColor(Some(&background));
    })?;

    Ok(())
}

fn configure_overlay_shell(app: &tauri::App) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    {
        let window = app
            .get_webview_window("main")
            .expect("main overlay window to exist during setup");
        configure_macos_overlay_panel(&window)?;
    }

    Ok(())
}

fn apply_overlay_visibility(app_handle: &tauri::AppHandle, visible: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let panel = app_handle
            .get_webview_panel("main")
            .map_err(|_| "failed to access main overlay panel".to_string())?;

        if visible {
            panel.show();
        } else {
            panel.hide();
        }

        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let window = app_handle
            .get_webview_window("main")
            .ok_or_else(|| "failed to access main overlay window".to_string())?;

        if visible {
            window
                .show()
                .map_err(|error| format!("failed to show main overlay window: {error}"))?;
        } else {
            window
                .hide()
                .map_err(|error| format!("failed to hide main overlay window: {error}"))?;
        }

        Ok(())
    }
}

#[tauri::command]
fn set_overlay_visibility(app_handle: tauri::AppHandle, visible: bool) -> Result<(), String> {
    apply_overlay_visibility(&app_handle, visible)
}

#[tauri::command]
fn exit_overlay_application(app_handle: tauri::AppHandle) -> Result<(), String> {
    app_handle.exit(0);
    Ok(())
}

#[tauri::command]
fn persist_overlay_requested_action(
    app_handle: tauri::AppHandle,
    requested_action: String,
    updated_at: String,
    visible: bool,
) -> Result<(), String> {
    let requested_action = requested_action.trim().to_ascii_lowercase();
    if requested_action != "ensure" && requested_action != "show" && requested_action != "hide" {
        return Err(format!(
            "invalid overlay requested_action {requested_action:?}; expected ensure, show, or hide"
        ));
    }

    let workspace_root = resolve_overlay_workspace_root(&app_handle)?.ok_or_else(|| {
        "failed to resolve overlay workspace root for control state persistence".to_string()
    })?;
    let runtime_dir = overlay_runtime_dir_for_workspace(workspace_root.as_path());
    let control_path = runtime_dir.join("overlay-control.json");
    let payload = format!(
        "{{\n  \"workspace_path\": {:?},\n  \"requested_action\": {:?},\n  \"updated_at\": {:?},\n  \"visible\": {}\n}}\n",
        workspace_root.display().to_string(),
        requested_action,
        updated_at,
        visible,
    );

    fs::create_dir_all(&runtime_dir).map_err(|error| {
        format!(
            "failed to create overlay runtime directory at {}: {error}",
            runtime_dir.display()
        )
    })?;
    fs::write(&control_path, payload).map_err(|error| {
        format!(
            "failed to write overlay control state at {}: {error}",
            control_path.display()
        )
    })
}

fn apply_overlay_size(
    app_handle: &tauri::AppHandle,
    width: f64,
    height: f64,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let panel = app_handle
            .get_webview_panel("main")
            .map_err(|_| "failed to access main overlay panel".to_string())?;

        panel.set_content_size(width, height);
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let window = app_handle
            .get_webview_window("main")
            .ok_or_else(|| "failed to access main overlay window".to_string())?;

        window
            .set_size(tauri::LogicalSize::new(width, height))
            .map_err(|error| format!("failed to set overlay window size: {error}"))?;

        Ok(())
    }
}

#[tauri::command]
fn set_overlay_size(
    app_handle: tauri::AppHandle,
    width: f64,
    height: f64,
) -> Result<(), String> {
    apply_overlay_size(&app_handle, width, height)
}

#[tauri::command]
fn play_overlay_alert_sound(kind: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let sound_path = match kind.as_str() {
            "needs_feedback" => "/System/Library/Sounds/Ping.aiff",
            "all_tasks_done" => "/System/Library/Sounds/Glass.aiff",
            _ => return Ok(()),
        };

        std::process::Command::new("/usr/bin/afplay")
            .arg(sound_path)
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("failed to play overlay alert sound: {error}"))
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = kind;
        Ok(())
    }
}

#[tauri::command]
fn start_overlay_drag(app_handle: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let panel = app_handle
            .get_webview_panel("main")
            .map_err(|_| "failed to access main overlay panel".to_string())?;

        unsafe {
            let app = tauri_nspanel::objc2_app_kit::NSApp(
                tauri_nspanel::objc2::MainThreadMarker::new_unchecked(),
            );
            let current_event = app
                .currentEvent()
                .ok_or_else(|| "failed to read current macOS event for overlay drag".to_string())?;

            let drag_event = if current_event.r#type() == tauri_nspanel::objc2_app_kit::NSEventType::ApplicationDefined {
                tauri_nspanel::objc2_app_kit::NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
                    tauri_nspanel::objc2_app_kit::NSEventType::LeftMouseDown,
                    tauri_nspanel::objc2_app_kit::NSEvent::mouseLocation(),
                    current_event.modifierFlags(),
                    current_event.timestamp(),
                    current_event.windowNumber(),
                    None,
                    0,
                    1,
                    1.0,
                ).ok_or_else(|| "failed to synthesize drag event for overlay panel".to_string())?
            } else {
                current_event
            };

            panel.as_panel().performWindowDragWithEvent(&drag_event);
        }

        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let window = app_handle
            .get_webview_window("main")
            .ok_or_else(|| "failed to access main overlay window".to_string())?;

        window
            .start_dragging()
            .map_err(|error| format!("failed to start overlay drag: {error}"))?;

        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .manage(OverlayWorkspaceState::default())
        .invoke_handler(tauri::generate_handler![
        load_overlay_snapshot,
        load_overlay_control_state,
        persist_overlay_requested_action,
        set_overlay_visibility,
        exit_overlay_application,
        set_overlay_size,
        play_overlay_alert_sound,
        start_overlay_drag
    ]);

    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let cwd = PathBuf::from(cwd);
            let _ = apply_secondary_launch(app, &args, Some(cwd.as_path()));
        }));
    }

    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }

    builder
        .setup(|app| {
            initialize_workspace_override(app);
            Ok(configure_overlay_shell(app)?)
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    fn unique_temp_path(label: &str) -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();

        std::env::temp_dir().join(format!("superplan-overlay-{label}-{timestamp}"))
    }

    fn create_snapshot_file(workspace_root: &Path) -> PathBuf {
        create_runtime_file(workspace_root, "overlay.json")
    }

    fn create_control_file(workspace_root: &Path) -> PathBuf {
        create_runtime_file(workspace_root, "overlay-control.json")
    }

    fn create_superplan_root(workspace_root: &Path) {
        fs::create_dir_all(workspace_root.join(".superplan")).expect("create superplan root");
    }

    fn create_runtime_file(workspace_root: &Path, file_name: &str) -> PathBuf {
        let runtime_file = workspace_root.join(".superplan/runtime").join(file_name);
        fs::create_dir_all(runtime_file.parent().expect("runtime file parent"))
            .expect("create runtime dir");
        fs::write(&runtime_file, "{\"visible\":true}").expect("write runtime file");
        runtime_file
    }

    #[test]
    fn resolve_overlay_snapshot_path_prefers_workspace_override() {
        let workspace_root = unique_temp_path("override");
        let cwd_root = unique_temp_path("cwd");
        let manifest_root = unique_temp_path("manifest");

        let snapshot_path = create_snapshot_file(&workspace_root);

        let resolved = super::resolve_overlay_snapshot_path_from_sources(
            Some(workspace_root.as_path()),
            cwd_root.as_path(),
            manifest_root.as_path(),
        );

        assert_eq!(resolved.as_deref(), Some(snapshot_path.as_path()));

        let _ = fs::remove_dir_all(workspace_root);
        let _ = fs::remove_dir_all(cwd_root);
        let _ = fs::remove_dir_all(manifest_root);
    }

    #[test]
    fn resolve_overlay_snapshot_path_finds_ancestor_workspace_snapshot() {
        let workspace_root = unique_temp_path("ancestor");
        let cwd_root = workspace_root.join("apps/overlay-desktop/src-tauri");
        let manifest_root = unique_temp_path("manifest");

        let snapshot_path = create_snapshot_file(&workspace_root);
        fs::create_dir_all(&cwd_root).expect("create cwd path");

        let resolved = super::resolve_overlay_snapshot_path_from_sources(
            None,
            cwd_root.as_path(),
            manifest_root.as_path(),
        );

        assert_eq!(resolved.as_deref(), Some(snapshot_path.as_path()));

        let _ = fs::remove_dir_all(workspace_root);
        let _ = fs::remove_dir_all(manifest_root);
    }

    #[test]
    fn resolve_overlay_control_path_prefers_workspace_override() {
        let workspace_root = unique_temp_path("control-override");
        let cwd_root = unique_temp_path("control-cwd");
        let manifest_root = unique_temp_path("control-manifest");

        let control_path = create_control_file(&workspace_root);

        let resolved = super::resolve_overlay_control_path_from_sources(
            Some(workspace_root.as_path()),
            cwd_root.as_path(),
            manifest_root.as_path(),
        );

        assert_eq!(resolved.as_deref(), Some(control_path.as_path()));

        let _ = fs::remove_dir_all(workspace_root);
        let _ = fs::remove_dir_all(cwd_root);
        let _ = fs::remove_dir_all(manifest_root);
    }

    #[test]
    fn resolve_overlay_control_path_finds_ancestor_workspace_file() {
        let workspace_root = unique_temp_path("control-ancestor");
        let cwd_root = workspace_root.join("apps/overlay-desktop/src-tauri");
        let manifest_root = unique_temp_path("control-manifest");

        let control_path = create_control_file(&workspace_root);
        fs::create_dir_all(&cwd_root).expect("create cwd path");

        let resolved = super::resolve_overlay_control_path_from_sources(
            None,
            cwd_root.as_path(),
            manifest_root.as_path(),
        );

        assert_eq!(resolved.as_deref(), Some(control_path.as_path()));

        let _ = fs::remove_dir_all(workspace_root);
        let _ = fs::remove_dir_all(manifest_root);
    }

    #[test]
    fn parse_workspace_override_supports_inline_and_positional_flag_values() {
        let inline = super::parse_workspace_override_from_args(&[
            "overlay".to_string(),
            "--workspace=/tmp/inline-workspace".to_string(),
        ]);
        let positional = super::parse_workspace_override_from_args(&[
            "overlay".to_string(),
            "--workspace".to_string(),
            "/tmp/flag-workspace".to_string(),
        ]);

        assert_eq!(inline, Some(PathBuf::from("/tmp/inline-workspace")));
        assert_eq!(positional, Some(PathBuf::from("/tmp/flag-workspace")));
    }

    #[test]
    fn resolve_launch_workspace_override_prefers_args_then_workspace_cwd() {
        let explicit_root = unique_temp_path("launch-explicit");
        let cwd_root = unique_temp_path("launch-cwd");
        let cwd_child = cwd_root.join("apps/overlay-desktop");

        create_superplan_root(&explicit_root);
        create_superplan_root(&cwd_root);
        fs::create_dir_all(&cwd_child).expect("create cwd child");

        let explicit = super::resolve_launch_workspace_override(
            &[
                "overlay".to_string(),
                "--workspace".to_string(),
                explicit_root.display().to_string(),
            ],
            Some(cwd_child.as_path()),
        );

        let from_cwd = super::resolve_launch_workspace_override(&[], Some(cwd_child.as_path()));

        assert_eq!(explicit.as_deref(), Some(explicit_root.as_path()));
        assert_eq!(from_cwd.as_deref(), Some(cwd_root.as_path()));

        let _ = fs::remove_dir_all(explicit_root);
        let _ = fs::remove_dir_all(cwd_root);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn overlay_collection_behavior_includes_fullscreen_auxiliary_flags() {
        use tauri_nspanel::objc2_app_kit::NSWindowCollectionBehavior as Behavior;

        let behavior = super::overlay_panel_collection_behavior().value();

        assert!(behavior.contains(Behavior::CanJoinAllSpaces));
        assert!(behavior.contains(Behavior::FullScreenAuxiliary));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn overlay_style_mask_enables_nonactivating_panel_behavior() {
        use tauri_nspanel::objc2_app_kit::NSWindowStyleMask as Mask;

        let mask = super::overlay_panel_style_mask().value();

        assert!(mask.contains(Mask::NonactivatingPanel));
    }
}
