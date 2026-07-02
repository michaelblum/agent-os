#!/usr/bin/env bash

_agent_workspace_fixtures_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/agent-workspace-fixtures" && pwd)"

source "$_agent_workspace_fixtures_dir/common.sh"
source "$_agent_workspace_fixtures_dir/native-file.sh"
source "$_agent_workspace_fixtures_dir/browser.sh"
source "$_agent_workspace_fixtures_dir/native-ax.sh"
source "$_agent_workspace_fixtures_dir/canvas.sh"
source "$_agent_workspace_fixtures_dir/mixed.sh"

unset _agent_workspace_fixtures_dir
