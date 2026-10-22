CREATE TABLE IF NOT EXISTS brand_intent_workspaces (
  workspace_key VARCHAR(64) NOT NULL PRIMARY KEY,
  owner_user_id INT NOT NULL,
  project_id VARCHAR(36) NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 0,
  payload JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX brand_intent_owner_project_idx (owner_user_id, project_id)
);
