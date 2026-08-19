#!/usr/bin/env ruby

require "optparse"
require "pathname"
require "yaml"

ROOT = File.expand_path("..", __dir__)
GRAPH_PATH = File.join(ROOT, "docs", "graph.yaml")

def load_yaml(path)
  YAML.safe_load(File.read(path), permitted_classes: [], aliases: false)
rescue Errno::ENOENT
  abort "file not found: #{path}"
rescue Psych::SyntaxError => e
  abort "invalid YAML #{path}: #{e.message}"
end

def graph
  @graph ||= load_yaml(GRAPH_PATH)
end

def documents_by_id
  @documents_by_id ||= graph.fetch("documents").to_h { |document| [document.fetch("id"), document] }
end

def markdown_files
  roots = [File.join(ROOT, "README.md"), File.join(ROOT, "AGENTS.md")]
  docs = Dir[File.join(ROOT, "docs", "**", "*.md")]
  agent_skills = Dir[File.join(ROOT, ".agents", "skills", "**", "*.md")]
  (roots + docs + agent_skills).select { |path| File.file?(path) }.map { |path| Pathname.new(path).relative_path_from(Pathname.new(ROOT)).to_s }.sort
end

def local_markdown_links(path)
  source = File.read(File.join(ROOT, path))
  source.scan(/\[[^\]]*\]\(([^)]+)\)/).flatten.each_with_object([]) do |link, links|
    next if link.match?(/\A(?:https?:|mailto:|#)/)

    clean = link.split("#", 2).first
    next if clean.nil? || clean.empty?

    links << clean
  end
end

def validate_graph
  errors = []
  warnings = []
  documents = graph.fetch("documents", [])
  relations = graph.fetch("relations", [])

  ids = documents.map { |document| document["id"] }
  paths = documents.map { |document| document["path"] }

  ids.group_by(&:itself).each { |id, values| errors << "duplicate document id: #{id}" if values.size > 1 }
  paths.group_by(&:itself).each { |path, values| errors << "duplicate document path: #{path}" if values.size > 1 }

  documents.each do |document|
    %w[id path type status scope authority].each do |field|
      errors << "document missing #{field}: #{document.inspect}" if document[field].nil? || document[field].to_s.empty?
    end
    errors << "registered path does not exist: #{document['path']}" unless File.file?(File.join(ROOT, document.fetch("path")))
  end

  registered_markdown = paths.select { |path| path&.end_with?(".md") }.sort
  (markdown_files - registered_markdown).each { |path| errors << "unregistered Markdown document: #{path}" }
  (registered_markdown - markdown_files).each { |path| errors << "registered Markdown document missing from filesystem: #{path}" }

  relation_degree = Hash.new(0)
  relations.each do |relation|
    from = relation["from"]
    to = relation["to"]
    type = relation["type"]
    errors << "relation missing from/to/type: #{relation.inspect}" if from.nil? || to.nil? || type.nil?
    errors << "relation references unknown source: #{from}" unless ids.include?(from)
    errors << "relation references unknown target: #{to}" unless ids.include?(to)
    relation_degree[from] += 1
    relation_degree[to] += 1
  end

  exempt_types = %w[entrypoint agent-instructions index template]
  documents.each do |document|
    next if exempt_types.include?(document["type"])
    errors << "orphan document node: #{document['id']}" if relation_degree[document["id"]].zero?
  end

  entrypoints = graph.fetch("entrypoints", {})
  entrypoints.each do |name, id|
    errors << "entrypoint #{name} references unknown document: #{id}" unless ids.include?(id)
  end

  routing = graph.fetch("routing", {})
  routing_ids = []
  routing_ids.concat(routing.fetch("baseline", []))
  routing.fetch("intents", {}).each_value { |values| routing_ids.concat(values) }
  routing.fetch("path_rules", []).each do |rule|
    errors << "path rule missing match: #{rule.inspect}" unless rule["match"]
    routing_ids.concat(rule.fetch("read", []))
    routing_ids.concat(rule.fetch("review", []))
  end
  routing_ids.uniq.each { |id| errors << "routing references unknown document: #{id}" unless ids.include?(id) }

  graph_relations = relations.map { |relation| relation["type"] }.uniq
  routing.fetch("propagating_relations", []).each do |type|
    warnings << "propagating relation type is unused: #{type}" unless graph_relations.include?(type)
  end

  markdown_files.each do |path|
    local_markdown_links(path).each do |link|
      target = File.expand_path(link, File.dirname(File.join(ROOT, path)))
      errors << "broken Markdown link: #{path} -> #{link}" unless File.exist?(target)
    end
  end

  if warnings.any?
    warnings.each { |warning| warn "warning: #{warning}" }
  end

  if errors.any?
    errors.each { |error| warn "error: #{error}" }
    abort "documentation graph validation failed with #{errors.size} error(s)"
  end

  puts "documentation graph valid: #{documents.size} documents, #{relations.size} relations, #{markdown_files.size} Markdown files"
end

def matching_path_rule?(pattern, path)
  File.fnmatch?(pattern, path, File::FNM_PATHNAME | File::FNM_EXTGLOB)
end

def build_context_plan(intents:, paths:)
  routing = graph.fetch("routing")
  read = routing.fetch("baseline", []).dup
  review = []
  relation_seeds = []

  intents.each do |intent|
    selected = routing.fetch("intents", {}).fetch(intent, [])
    read.concat(selected)
    relation_seeds.concat(selected)
  end

  paths.each do |path|
    changed_document = graph.fetch("documents").find { |document| document.fetch("path") == path }
    if changed_document
      read << changed_document.fetch("id")
      relation_seeds << changed_document.fetch("id")
    end

    routing.fetch("path_rules", []).each do |rule|
      next unless matching_path_rule?(rule.fetch("match"), path)

      read.concat(rule.fetch("read", []))
      review.concat(rule.fetch("review", []))
      relation_seeds.concat(rule.fetch("read", []))
    end
  end

  propagating = routing.fetch("propagating_relations", [])
  graph.fetch("relations", []).each do |relation|
    next unless propagating.include?(relation.fetch("type"))

    from = relation.fetch("from")
    to = relation.fetch("to")
    review << to if relation_seeds.include?(from)
    review << from if relation_seeds.include?(to)
  end

  read = read.uniq
  review = review.uniq - read

  {
    "graph_revision" => graph.fetch("graph_revision"),
    "intents" => intents,
    "paths" => paths,
    "required_read" => read.map { |id| documents_by_id.fetch(id).slice("id", "path", "type", "authority") },
    "required_review" => review.map { |id| documents_by_id.fetch(id).slice("id", "path", "type", "authority") }
  }
end

def related_documents(document_id)
  abort "unknown document id: #{document_id}" unless documents_by_id.key?(document_id)

  relations = graph.fetch("relations").each_with_object([]) do |relation, related|
    if relation.fetch("from") == document_id
      related << {
        "direction" => "outgoing",
        "relation" => relation.fetch("type"),
        "document" => documents_by_id.fetch(relation.fetch("to")).slice("id", "path", "type", "authority")
      }
    elsif relation.fetch("to") == document_id
      related << {
        "direction" => "incoming",
        "relation" => relation.fetch("type"),
        "document" => documents_by_id.fetch(relation.fetch("from")).slice("id", "path", "type", "authority")
      }
    end
  end

  puts YAML.dump("document" => documents_by_id.fetch(document_id), "relations" => relations)
end

def print_mermaid
  puts "flowchart LR"
  graph.fetch("documents").each do |document|
    node = document.fetch("id").gsub(/[^a-zA-Z0-9_]/, "_")
    label = "#{document.fetch('id')}<br/>#{document.fetch('type')}"
    puts "  #{node}[\"#{label}\"]"
  end
  graph.fetch("relations").each do |relation|
    from = relation.fetch("from").gsub(/[^a-zA-Z0-9_]/, "_")
    to = relation.fetch("to").gsub(/[^a-zA-Z0-9_]/, "_")
    puts "  #{from} -->|#{relation.fetch('type')}| #{to}"
  end
end

def parse_route_options(arguments)
  options = { intents: [], paths: [] }
  parser = OptionParser.new do |opts|
    opts.banner = "Usage: ruby scripts/docs_graph.rb route [--intent NAME] [--path PATH]"
    opts.on("--intent NAME", "Task intent; may be repeated") { |value| options[:intents] << value }
    opts.on("--path PATH", "Planned or changed path; may be repeated") { |value| options[:paths] << value }
  end
  parser.parse!(arguments)
  options[:intents] = ["any-agent-task"] if options[:intents].empty?
  options
end

def validate_impact(report_path)
  absolute_path = File.expand_path(report_path, ROOT)
  report = load_yaml(absolute_path)
  plan = build_context_plan(
    intents: report.fetch("intents", []),
    paths: report.fetch("changed_paths", [])
  )

  errors = []
  errors << "graph revision mismatch: report=#{report['graph_revision']} current=#{graph['graph_revision']}" unless report["graph_revision"] == graph["graph_revision"]

  docs = report.fetch("docs", {})
  read = docs.fetch("read", [])
  reviewed = docs.fetch("reviewed", {})

  required_read = plan.fetch("required_read").map { |document| document.fetch("id") }
  required_review = plan.fetch("required_review").map { |document| document.fetch("id") }

  (required_read - read).each { |id| errors << "required document not recorded as read: #{id}" }
  (required_review - reviewed.keys).each { |id| errors << "required document has no impact disposition: #{id}" }

  allowed = graph.fetch("impact_policy").fetch("required_disposition")
  reviewed.each do |id, disposition|
    errors << "impact report references unknown document: #{id}" unless documents_by_id.key?(id)
    outcome = disposition["outcome"]
    reason = disposition["reason"].to_s.strip
    errors << "invalid impact outcome for #{id}: #{outcome.inspect}" unless allowed.include?(outcome)
    if %w[unchanged not_applicable].include?(outcome) && reason.empty?
      errors << "impact outcome #{outcome} requires a reason: #{id}"
    end
  end

  if errors.any?
    errors.each { |error| warn "error: #{error}" }
    abort "documentation impact validation failed with #{errors.size} error(s)"
  end

  puts "documentation impact valid: #{required_read.size} required reads, #{required_review.size} reviewed impacts"
end

command = ARGV.shift || "validate"

case command
when "validate"
  validate_graph
when "route"
  options = parse_route_options(ARGV)
  puts YAML.dump("context_plan" => build_context_plan(intents: options[:intents], paths: options[:paths]))
when "validate-impact"
  report_path = nil
  OptionParser.new do |opts|
    opts.banner = "Usage: ruby scripts/docs_graph.rb validate-impact --report PATH"
    opts.on("--report PATH", "Docs Impact Report YAML") { |value| report_path = value }
  end.parse!(ARGV)
  abort "--report is required" unless report_path
  validate_impact(report_path)
when "related"
  document_id = nil
  OptionParser.new do |opts|
    opts.banner = "Usage: ruby scripts/docs_graph.rb related --doc DOCUMENT_ID"
    opts.on("--doc DOCUMENT_ID", "Document node ID") { |value| document_id = value }
  end.parse!(ARGV)
  abort "--doc is required" unless document_id
  related_documents(document_id)
when "mermaid"
  print_mermaid
else
  abort "unknown command: #{command}; expected validate, route, validate-impact, related, or mermaid"
end
