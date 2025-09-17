-- Learning Paths and Collections Migration
-- Adds comprehensive learning path functionality with collections, prerequisites, and progress tracking

-- Learning Paths table
CREATE TABLE learning_paths (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  short_description TEXT,
  category TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('BEGINNER', 'INTERMEDIATE', 'ADVANCED')),
  estimated_duration INTEGER NOT NULL DEFAULT 0, -- in minutes

  -- Path metadata
  tags TEXT[] DEFAULT '{}',
  skills TEXT[] DEFAULT '{}', -- Skills this path teaches
  prerequisites TEXT[] DEFAULT '{}', -- Required skills/paths before starting
  learning_objectives TEXT[] DEFAULT '{}',

  -- Visibility and access
  is_public BOOLEAN NOT NULL DEFAULT true,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  is_template BOOLEAN NOT NULL DEFAULT false,
  template_category TEXT, -- For role-based templates (developer, manager, etc.)

  -- Authoring
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,

  -- Status
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  published_at TIMESTAMP,

  -- Metrics
  enrollment_count INTEGER NOT NULL DEFAULT 0,
  completion_count INTEGER NOT NULL DEFAULT 0,
  average_rating REAL DEFAULT 0,
  average_completion_time INTEGER DEFAULT 0, -- in minutes

  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Learning Path Items (courses, modules, or other paths)
CREATE TABLE learning_path_items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  learning_path_id TEXT NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,

  -- Item details
  item_type TEXT NOT NULL CHECK (item_type IN ('COURSE', 'MODULE', 'LEARNING_PATH', 'ASSESSMENT', 'RESOURCE')),
  item_id TEXT NOT NULL, -- References course.id, module.id, etc.
  title TEXT NOT NULL, -- Cached for performance
  description TEXT,

  -- Ordering and structure
  order_index INTEGER NOT NULL,
  section TEXT, -- Optional grouping within path

  -- Requirements
  is_required BOOLEAN NOT NULL DEFAULT true,
  prerequisites TEXT[] DEFAULT '{}', -- Item IDs that must be completed first

  -- Timing
  estimated_duration INTEGER DEFAULT 0, -- in minutes
  unlock_delay INTEGER DEFAULT 0, -- minutes after prerequisites are met

  -- Metadata
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(learning_path_id, order_index)
);

-- Learning Path Enrollments
CREATE TABLE learning_path_enrollments (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  learning_path_id TEXT NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,

  -- Progress tracking
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'PAUSED', 'DROPPED')),
  progress_percentage REAL NOT NULL DEFAULT 0 CHECK (progress_percentage >= 0 AND progress_percentage <= 100),
  current_item_id TEXT, -- Current item being worked on

  -- Timing
  enrolled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  last_accessed_at TIMESTAMP,
  estimated_completion_date TIMESTAMP,

  -- Metrics
  time_spent INTEGER DEFAULT 0, -- in minutes
  completion_score REAL, -- Overall score if applicable

  -- Settings
  auto_enroll_courses BOOLEAN DEFAULT true,
  notification_preferences JSONB DEFAULT '{}',

  UNIQUE(user_id, learning_path_id)
);

-- Learning Path Item Progress
CREATE TABLE learning_path_item_progress (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  enrollment_id TEXT NOT NULL REFERENCES learning_path_enrollments(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES learning_path_items(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Progress details
  status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED')),
  progress_percentage REAL NOT NULL DEFAULT 0 CHECK (progress_percentage >= 0 AND progress_percentage <= 100),

  -- Timing
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  last_accessed_at TIMESTAMP,

  -- Results
  score REAL,
  attempts INTEGER DEFAULT 0,
  time_spent INTEGER DEFAULT 0, -- in minutes

  -- Metadata
  notes TEXT,
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(enrollment_id, item_id)
);

-- Collections (curated groups of learning paths)
CREATE TABLE collections (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  short_description TEXT,

  -- Collection metadata
  category TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  target_audience TEXT[] DEFAULT '{}', -- roles, departments, skill levels

  -- Visual
  thumbnail_url TEXT,
  banner_url TEXT,
  color_theme TEXT DEFAULT '#3B82F6',

  -- Content organization
  learning_path_count INTEGER DEFAULT 0,
  total_estimated_duration INTEGER DEFAULT 0, -- in minutes

  -- Visibility
  is_public BOOLEAN NOT NULL DEFAULT true,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  is_curated BOOLEAN NOT NULL DEFAULT true,

  -- Authoring
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,

  -- Status
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  published_at TIMESTAMP,

  -- Metrics
  view_count INTEGER DEFAULT 0,
  enrollment_count INTEGER DEFAULT 0,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Collection Items (learning paths in collections)
CREATE TABLE collection_items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  learning_path_id TEXT NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,

  -- Organization
  order_index INTEGER NOT NULL,
  section TEXT, -- Optional grouping within collection

  -- Display
  featured BOOLEAN DEFAULT false,
  custom_title TEXT, -- Override path title in this collection
  custom_description TEXT,

  -- Recommendations
  difficulty_boost INTEGER DEFAULT 0, -- Adjust difficulty perception
  priority INTEGER DEFAULT 0, -- Higher = more important

  added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  added_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  UNIQUE(collection_id, learning_path_id),
  UNIQUE(collection_id, order_index)
);

-- Skills taxonomy
CREATE TABLE skills (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  category TEXT NOT NULL,
  parent_skill_id TEXT REFERENCES skills(id) ON DELETE SET NULL,

  -- Difficulty and prerequisites
  difficulty_level INTEGER DEFAULT 1 CHECK (difficulty_level >= 1 AND difficulty_level <= 10),
  prerequisite_skills TEXT[] DEFAULT '{}',

  -- Metadata
  tags TEXT[] DEFAULT '{}',
  industry_relevance TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- User Skills (tracking acquired skills)
CREATE TABLE user_skills (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,

  -- Proficiency
  proficiency_level INTEGER NOT NULL CHECK (proficiency_level >= 1 AND proficiency_level <= 10),
  confidence_score REAL DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 1),

  -- Evidence
  acquired_from TEXT, -- 'COURSE', 'ASSESSMENT', 'MANUAL', 'CERTIFICATION'
  source_id TEXT, -- ID of course, assessment, etc.
  verification_status TEXT DEFAULT 'SELF_REPORTED' CHECK (verification_status IN ('SELF_REPORTED', 'ASSESSED', 'CERTIFIED')),

  -- Timing
  acquired_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP,
  expires_at TIMESTAMP, -- For skills that need refresh

  -- Metadata
  notes TEXT,
  metadata JSONB DEFAULT '{}',

  UNIQUE(user_id, skill_id)
);

-- Learning Path Templates (for common roles/scenarios)
CREATE TABLE learning_path_templates (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL, -- 'ROLE', 'SKILL', 'INDUSTRY', 'CERTIFICATION'
  template_type TEXT NOT NULL, -- 'DEVELOPER', 'MANAGER', 'DESIGNER', etc.

  -- Target criteria
  target_roles TEXT[] DEFAULT '{}',
  target_departments TEXT[] DEFAULT '{}',
  target_skill_level TEXT DEFAULT 'BEGINNER',
  industry TEXT,

  -- Template structure (JSON)
  template_structure JSONB NOT NULL,
  variable_fields TEXT[] DEFAULT '{}', -- Fields that can be customized

  -- Usage
  usage_count INTEGER DEFAULT 0,
  is_featured BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,

  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Learning Path Recommendations
CREATE TABLE learning_path_recommendations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  learning_path_id TEXT NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,

  -- Recommendation details
  recommendation_type TEXT NOT NULL CHECK (recommendation_type IN ('SKILL_BASED', 'ROLE_BASED', 'COLLABORATIVE', 'TRENDING', 'SIMILAR_USERS')),
  confidence_score REAL NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  reasoning TEXT,

  -- Factors
  skill_match_score REAL DEFAULT 0,
  role_match_score REAL DEFAULT 0,
  difficulty_fit_score REAL DEFAULT 0,
  time_availability_score REAL DEFAULT 0,

  -- Status
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VIEWED', 'ACCEPTED', 'DISMISSED')),
  viewed_at TIMESTAMP,
  responded_at TIMESTAMP,

  -- Metadata
  recommendation_data JSONB DEFAULT '{}',

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP
);

-- Path Dependencies (for complex prerequisite management)
CREATE TABLE path_dependencies (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  dependent_path_id TEXT NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
  prerequisite_path_id TEXT NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,

  -- Dependency details
  dependency_type TEXT NOT NULL DEFAULT 'REQUIRED' CHECK (dependency_type IN ('REQUIRED', 'RECOMMENDED', 'OPTIONAL')),
  minimum_completion_percentage REAL DEFAULT 100 CHECK (minimum_completion_percentage >= 0 AND minimum_completion_percentage <= 100),

  -- Conditions
  required_score REAL, -- Minimum score needed
  required_skills TEXT[] DEFAULT '{}',

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(dependent_path_id, prerequisite_path_id)
);

-- Indexes for performance
CREATE INDEX idx_learning_paths_status ON learning_paths(status);
CREATE INDEX idx_learning_paths_category ON learning_paths(category);
CREATE INDEX idx_learning_paths_difficulty ON learning_paths(difficulty);
CREATE INDEX idx_learning_paths_tags ON learning_paths USING GIN(tags);
CREATE INDEX idx_learning_paths_skills ON learning_paths USING GIN(skills);
CREATE INDEX idx_learning_paths_featured ON learning_paths(is_featured) WHERE is_featured = true;
CREATE INDEX idx_learning_paths_template ON learning_paths(is_template, template_category) WHERE is_template = true;

CREATE INDEX idx_learning_path_items_path ON learning_path_items(learning_path_id);
CREATE INDEX idx_learning_path_items_type ON learning_path_items(item_type);
CREATE INDEX idx_learning_path_items_order ON learning_path_items(learning_path_id, order_index);

CREATE INDEX idx_learning_path_enrollments_user ON learning_path_enrollments(user_id);
CREATE INDEX idx_learning_path_enrollments_path ON learning_path_enrollments(learning_path_id);
CREATE INDEX idx_learning_path_enrollments_status ON learning_path_enrollments(status);
CREATE INDEX idx_learning_path_enrollments_progress ON learning_path_enrollments(progress_percentage);

CREATE INDEX idx_learning_path_item_progress_enrollment ON learning_path_item_progress(enrollment_id);
CREATE INDEX idx_learning_path_item_progress_user ON learning_path_item_progress(user_id);
CREATE INDEX idx_learning_path_item_progress_status ON learning_path_item_progress(status);

CREATE INDEX idx_collections_status ON collections(status);
CREATE INDEX idx_collections_category ON collections(category);
CREATE INDEX idx_collections_featured ON collections(is_featured) WHERE is_featured = true;
CREATE INDEX idx_collections_tags ON collections USING GIN(tags);

CREATE INDEX idx_collection_items_collection ON collection_items(collection_id);
CREATE INDEX idx_collection_items_path ON collection_items(learning_path_id);
CREATE INDEX idx_collection_items_order ON collection_items(collection_id, order_index);

CREATE INDEX idx_skills_category ON skills(category);
CREATE INDEX idx_skills_parent ON skills(parent_skill_id);
CREATE INDEX idx_skills_active ON skills(is_active) WHERE is_active = true;

CREATE INDEX idx_user_skills_user ON user_skills(user_id);
CREATE INDEX idx_user_skills_skill ON user_skills(skill_id);
CREATE INDEX idx_user_skills_proficiency ON user_skills(proficiency_level);
CREATE INDEX idx_user_skills_verification ON user_skills(verification_status);

CREATE INDEX idx_learning_path_templates_category ON learning_path_templates(category);
CREATE INDEX idx_learning_path_templates_type ON learning_path_templates(template_type);
CREATE INDEX idx_learning_path_templates_active ON learning_path_templates(is_active) WHERE is_active = true;

CREATE INDEX idx_learning_path_recommendations_user ON learning_path_recommendations(user_id);
CREATE INDEX idx_learning_path_recommendations_path ON learning_path_recommendations(learning_path_id);
CREATE INDEX idx_learning_path_recommendations_type ON learning_path_recommendations(recommendation_type);
CREATE INDEX idx_learning_path_recommendations_status ON learning_path_recommendations(status);
CREATE INDEX idx_learning_path_recommendations_score ON learning_path_recommendations(confidence_score);

CREATE INDEX idx_path_dependencies_dependent ON path_dependencies(dependent_path_id);
CREATE INDEX idx_path_dependencies_prerequisite ON path_dependencies(prerequisite_path_id);

-- Triggers for updating timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_learning_paths_updated_at BEFORE UPDATE ON learning_paths FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_learning_path_items_updated_at BEFORE UPDATE ON learning_path_items FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_learning_path_item_progress_updated_at BEFORE UPDATE ON learning_path_item_progress FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_collections_updated_at BEFORE UPDATE ON collections FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_skills_updated_at BEFORE UPDATE ON skills FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER update_learning_path_templates_updated_at BEFORE UPDATE ON learning_path_templates FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Function to calculate learning path progress
CREATE OR REPLACE FUNCTION calculate_learning_path_progress(enrollment_id TEXT)
RETURNS REAL AS $$
DECLARE
    total_items INTEGER;
    completed_items INTEGER;
    progress_percentage REAL;
BEGIN
    -- Count total required items
    SELECT COUNT(*) INTO total_items
    FROM learning_path_items lpi
    JOIN learning_path_enrollments lpe ON lpe.learning_path_id = lpi.learning_path_id
    WHERE lpe.id = enrollment_id AND lpi.is_required = true;

    -- Count completed required items
    SELECT COUNT(*) INTO completed_items
    FROM learning_path_item_progress lpip
    JOIN learning_path_items lpi ON lpi.id = lpip.item_id
    WHERE lpip.enrollment_id = enrollment_id
    AND lpip.status = 'COMPLETED'
    AND lpi.is_required = true;

    -- Calculate progress
    IF total_items = 0 THEN
        progress_percentage := 100;
    ELSE
        progress_percentage := (completed_items::REAL / total_items::REAL) * 100;
    END IF;

    -- Update enrollment progress
    UPDATE learning_path_enrollments
    SET progress_percentage = progress_percentage,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = enrollment_id;

    RETURN progress_percentage;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update learning path progress
CREATE OR REPLACE FUNCTION trigger_update_path_progress()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM calculate_learning_path_progress(NEW.enrollment_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_path_progress_on_item_completion
    AFTER UPDATE OF status ON learning_path_item_progress
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION trigger_update_path_progress();