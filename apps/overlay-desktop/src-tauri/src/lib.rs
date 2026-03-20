use std::{
    collections::HashSet,
    env, fs,
    path::{Path, PathBuf},
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

#[tauri::command]
fn load_overlay_snapshot() -> Result<String, String> {
    let snapshot_path = resolve_overlay_snapshot_path()?
    .ok_or_else(|| {
        "failed to locate .superplan/runtime/overlay.json from SUPERPLAN_OVERLAY_WORKSPACE, current working directory, or app manifest ancestors".to_string()
    })?;

    fs::read_to_string(&snapshot_path).map_err(|error| {
        format!(
            "failed to read overlay snapshot at {}: {error}",
            snapshot_path.display()
        )
    })
}

#[tauri::command]
fn load_overlay_control_state() -> Result<Option<String>, String> {
    let control_path = match resolve_overlay_control_path()? {
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

fn resolve_runtime_context() -> Result<(Option<PathBuf>, PathBuf, PathBuf), String> {
    let current_dir = env::current_dir()
        .map_err(|error| format!("failed to determine current working directory: {error}"))?;
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_override = env::var_os("SUPERPLAN_OVERLAY_WORKSPACE").map(PathBuf::from);

    Ok((workspace_override, current_dir, manifest_dir))
}

fn resolve_overlay_snapshot_path() -> Result<Option<PathBuf>, String> {
    let (workspace_override, current_dir, manifest_dir) = resolve_runtime_context()?;

    Ok(resolve_overlay_snapshot_path_from_sources(
        workspace_override.as_deref(),
        current_dir.as_path(),
        manifest_dir.as_path(),
    ))
}

fn resolve_overlay_control_path() -> Result<Option<PathBuf>, String> {
    let (workspace_override, current_dir, manifest_dir) = resolve_runtime_context()?;

    Ok(resolve_overlay_control_path_from_sources(
        workspace_override.as_deref(),
        current_dir.as_path(),
        manifest_dir.as_path(),
    ))
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
    panel.make_key_window();

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
            panel.show_and_make_key();
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
        panel.make_key_window();
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
    let builder = tauri::Builder::default().invoke_handler(tauri::generate_handler![
        load_overlay_snapshot,
        load_overlay_control_state,
        set_overlay_visibility,
        set_overlay_size,
        start_overlay_drag
    ]);

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());

    builder
        .setup(|app| Ok(configure_overlay_shell(app)?))
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
