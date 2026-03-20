# Even Toolkit -- Page Patterns

Full-page templates showing how to compose toolkit components into common screen types. Copy and adapt these patterns for your app.

All examples assume you have imported the necessary components:

```tsx
import {
  Page, ScreenHeader, SectionHeader, NavBar, NavHeader, SearchBar,
  CategoryFilter, Card, ListItem, Button, Toggle, Select, Input,
  Textarea, Badge, SettingsGroup, Divider, EmptyState, Loading,
  Dialog, ConfirmDialog, BottomSheet, CTAGroup, StepIndicator,
  StatCard, StatGrid, ChatContainer, ChatInput, SegmentedControl,
} from 'even-toolkit/web';
```

---

## Table of Contents

1. [Settings Page](#settings-page)
2. [List Page (Search + Filter)](#list-page)
3. [Form Page](#form-page)
4. [Detail Page](#detail-page)
5. [Wizard (Multi-Step)](#wizard-page)
6. [Dialog Flow](#dialog-flow)
7. [Dashboard Page](#dashboard-page)
8. [Chat / AI Page](#chat-page)

---

## Settings Page

A settings screen with grouped rows, toggles, selects, and a danger zone.

```tsx
function SettingsScreen() {
  const [notifications, setNotifications] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [language, setLanguage] = useState('en');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  return (
    <Page>
      <ScreenHeader title="Settings" />

      <SettingsGroup label="General">
        <ListItem
          title="Language"
          trailing={
            <Select
              options={[
                { value: 'en', label: 'English' },
                { value: 'it', label: 'Italiano' },
                { value: 'zh', label: 'Chinese' },
              ]}
              value={language}
              onValueChange={setLanguage}
            />
          }
        />
        <ListItem
          title="Dark Mode"
          subtitle="Use dark color scheme"
          trailing={<Toggle checked={darkMode} onChange={setDarkMode} />}
        />
      </SettingsGroup>

      <SettingsGroup label="Notifications">
        <ListItem
          title="Push Notifications"
          trailing={<Toggle checked={notifications} onChange={setNotifications} />}
        />
        <ListItem
          title="Timer Alerts"
          trailing={<Toggle checked={true} onChange={() => {}} />}
        />
      </SettingsGroup>

      <SettingsGroup label="Account">
        <ListItem title="Edit Profile" onPress={() => navigate('/profile')} />
        <ListItem title="Export Data" onPress={() => exportData()} />
      </SettingsGroup>

      <SettingsGroup label="Danger Zone">
        <ListItem
          title="Delete Account"
          trailing={<Badge variant="negative">Irreversible</Badge>}
          onPress={() => setShowDeleteConfirm(true)}
        />
      </SettingsGroup>

      <ConfirmDialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDeleteAccount}
        title="Delete your account?"
        description="All data will be permanently removed. This cannot be undone."
        variant="danger"
        confirmLabel="Delete Account"
      />
    </Page>
  );
}
```

---

## List Page

A browsable list with search bar, category filter, and empty state handling.

```tsx
function RecipeListScreen() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const categories = ['All', 'Italian', 'Mexican', 'Asian', 'Desserts'];

  const filtered = recipes
    .filter(r => category === 'All' || r.category === category)
    .filter(r => r.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <Page>
      <ScreenHeader
        title="Recipes"
        subtitle={`${recipes.length} recipes`}
        actions={<Button variant="highlight" size="sm" onClick={openAddRecipe}>Add</Button>}
      />

      <div className="px-3 mb-4">
        <SearchBar
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search recipes..."
        />
      </div>

      <div className="px-3 mb-4">
        <CategoryFilter
          categories={categories}
          selected={category}
          onSelect={setCategory}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No recipes found"
          description={query ? 'Try a different search term' : 'Add your first recipe to get started'}
          action={!query ? { label: 'Add Recipe', onClick: openAddRecipe } : undefined}
        />
      ) : (
        <div className="flex flex-col">
          {filtered.map(recipe => (
            <ListItem
              key={recipe.id}
              title={recipe.name}
              subtitle={`${recipe.time} min -- ${recipe.category}`}
              leading={<Badge variant="accent">{recipe.difficulty}</Badge>}
              trailing={<span className="text-[13px] text-text-dim">&rsaquo;</span>}
              onPress={() => navigate(`/recipe/${recipe.id}`)}
            />
          ))}
        </div>
      )}
    </Page>
  );
}
```

---

## Form Page

A form screen with validation, inputs, selects, and a submit flow.

```tsx
function AddRecipeScreen() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [servings, setServings] = useState('4');
  const [category, setCategory] = useState('italian');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      await createRecipe({ name, description, servings: Number(servings), category });
      navigate('/recipes');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Page>
      <NavHeader
        title="New Recipe"
        left={<Button variant="ghost" size="icon" onClick={() => navigate(-1)}>Back</Button>}
      />

      <div className="px-3 flex flex-col gap-4">
        <div>
          <label className="text-[13px] tracking-[-0.13px] text-text-dim mb-1 block">
            Recipe Name
          </label>
          <Input
            placeholder="e.g., Pasta Carbonara"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>

        <div>
          <label className="text-[13px] tracking-[-0.13px] text-text-dim mb-1 block">
            Description
          </label>
          <Textarea
            placeholder="Describe your recipe..."
            rows={4}
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[13px] tracking-[-0.13px] text-text-dim mb-1 block">
              Servings
            </label>
            <Select
              options={[
                { value: '1', label: '1 serving' },
                { value: '2', label: '2 servings' },
                { value: '4', label: '4 servings' },
                { value: '6', label: '6 servings' },
              ]}
              value={servings}
              onValueChange={setServings}
            />
          </div>
          <div>
            <label className="text-[13px] tracking-[-0.13px] text-text-dim mb-1 block">
              Category
            </label>
            <Select
              options={[
                { value: 'italian', label: 'Italian' },
                { value: 'mexican', label: 'Mexican' },
                { value: 'asian', label: 'Asian' },
              ]}
              value={category}
              onValueChange={setCategory}
            />
          </div>
        </div>

        <Divider variant="spaced" />

        <Button
          variant="highlight"
          onClick={handleSubmit}
          disabled={!name.trim() || isSubmitting}
        >
          {isSubmitting ? <Loading size={20} /> : 'Create Recipe'}
        </Button>
      </div>
    </Page>
  );
}
```

---

## Detail Page

A detail screen showing rich content with a back navigation, sections, and actions.

```tsx
function RecipeDetailScreen({ recipeId }: { recipeId: string }) {
  const recipe = useRecipe(recipeId);
  const [showActions, setShowActions] = useState(false);

  if (!recipe) return <Page><Loading size={32} className="mx-auto mt-20" /></Page>;

  return (
    <Page>
      <NavHeader
        title={recipe.name}
        left={<Button variant="ghost" size="icon" onClick={() => navigate(-1)}>Back</Button>}
        right={<Button variant="ghost" size="icon" onClick={() => setShowActions(true)}>...</Button>}
      />

      <div className="px-3">
        {/* Hero Stats */}
        <StatGrid
          columns={3}
          stats={[
            { label: 'Prep', value: `${recipe.prepTime}m` },
            { label: 'Cook', value: `${recipe.cookTime}m` },
            { label: 'Servings', value: recipe.servings },
          ]}
        />

        {/* Description */}
        <SectionHeader title="About" />
        <Card>
          <p className="text-[15px] tracking-[-0.15px] text-text-dim">
            {recipe.description}
          </p>
        </Card>

        {/* Ingredients */}
        <SectionHeader
          title="Ingredients"
          action={<Badge variant="accent">{recipe.ingredients.length}</Badge>}
        />
        <div className="flex flex-col rounded-[6px] overflow-hidden">
          {recipe.ingredients.map((ing, i) => (
            <ListItem
              key={i}
              title={ing.name}
              trailing={
                <span className="text-[13px] tracking-[-0.13px] text-text-dim">
                  {ing.amount} {ing.unit}
                </span>
              }
            />
          ))}
        </div>

        {/* Steps */}
        <SectionHeader title="Instructions" />
        {recipe.steps.map((step, i) => (
          <Card key={i} padding="default" className="mb-2">
            <div className="flex gap-3">
              <span className="text-[13px] tracking-[-0.13px] text-accent font-normal shrink-0">
                Step {i + 1}
              </span>
              <p className="text-[15px] tracking-[-0.15px] text-text">{step}</p>
            </div>
          </Card>
        ))}

        {/* Start Cooking Button */}
        <div className="mt-6 mb-4">
          <Button variant="highlight" className="w-full" onClick={startCooking}>
            Start Cooking
          </Button>
        </div>
      </div>

      {/* Action Sheet */}
      <BottomSheet open={showActions} onClose={() => setShowActions(false)}>
        <CTAGroup
          layout="stacked"
          actions={[
            { label: 'Edit Recipe', onClick: () => navigate(`/recipe/${recipeId}/edit`) },
            { label: 'Share', onClick: shareRecipe },
            { label: 'Delete', onClick: () => setShowDeleteConfirm(true), variant: 'danger' },
          ]}
        />
      </BottomSheet>
    </Page>
  );
}
```

---

## Wizard Page

A multi-step form with progress tracking and step navigation.

```tsx
function OnboardingWizard() {
  const [step, setStep] = useState(1);
  const totalSteps = 3;

  return (
    <Page>
      <NavHeader title="Get Started" />

      <div className="px-3">
        {/* Step 1: Profile */}
        {step === 1 && (
          <div className="flex flex-col gap-4">
            <ScreenHeader title="Your Profile" subtitle="Tell us about yourself" />
            <Input placeholder="Your name" />
            <Select
              options={[
                { value: 'beginner', label: 'Beginner Cook' },
                { value: 'intermediate', label: 'Home Cook' },
                { value: 'advanced', label: 'Pro Chef' },
              ]}
              onValueChange={() => {}}
            />
          </div>
        )}

        {/* Step 2: Preferences */}
        {step === 2 && (
          <div className="flex flex-col gap-4">
            <ScreenHeader title="Preferences" subtitle="Customize your experience" />
            <ListItem
              title="Dark Mode"
              trailing={<Toggle checked={false} onChange={() => {}} />}
            />
            <ListItem
              title="Metric Units"
              trailing={<Toggle checked={true} onChange={() => {}} />}
            />
            <ListItem
              title="Timer Sounds"
              trailing={<Toggle checked={true} onChange={() => {}} />}
            />
          </div>
        )}

        {/* Step 3: Dietary */}
        {step === 3 && (
          <div className="flex flex-col gap-4">
            <ScreenHeader title="Dietary Preferences" subtitle="Select all that apply" />
            <Checkbox checked={false} onChange={() => {}} label="Vegetarian" />
            <Checkbox checked={false} onChange={() => {}} label="Vegan" />
            <Checkbox checked={false} onChange={() => {}} label="Gluten-free" />
            <Checkbox checked={false} onChange={() => {}} label="Dairy-free" />
            <Checkbox checked={false} onChange={() => {}} label="Nut-free" />
          </div>
        )}
      </div>

      {/* Step navigation (pinned to bottom) */}
      <div className="mt-auto px-3 py-4">
        <StepIndicator
          currentStep={step}
          totalSteps={totalSteps}
          onPrev={() => setStep(s => Math.max(1, s - 1))}
          onNext={() => {
            if (step < totalSteps) setStep(s => s + 1);
            else finishOnboarding();
          }}
        />
      </div>
    </Page>
  );
}
```

---

## Dialog Flow

A pattern for chaining dialogs and action sheets in a workflow.

```tsx
function RecipeActionsFlow({ recipe }) {
  const [activeDialog, setActiveDialog] = useState<string | null>(null);

  return (
    <>
      {/* Trigger */}
      <Button variant="ghost" size="icon" onClick={() => setActiveDialog('actions')}>
        ...
      </Button>

      {/* Step 1: Action Sheet */}
      <Dialog
        open={activeDialog === 'actions'}
        onClose={() => setActiveDialog(null)}
        title={recipe.name}
        actions={[
          { label: 'Edit', onClick: () => { setActiveDialog(null); navigate('/edit'); } },
          { label: 'Duplicate', onClick: () => { setActiveDialog('duplicate-confirm'); } },
          { label: 'Delete', onClick: () => { setActiveDialog('delete-confirm'); }, variant: 'danger' },
          { label: 'Cancel', onClick: () => setActiveDialog(null) },
        ]}
      />

      {/* Step 2a: Duplicate Confirmation */}
      <ConfirmDialog
        open={activeDialog === 'duplicate-confirm'}
        onClose={() => setActiveDialog(null)}
        onConfirm={() => { duplicateRecipe(recipe.id); setActiveDialog(null); }}
        title="Duplicate Recipe?"
        description={`Create a copy of "${recipe.name}"?`}
        confirmLabel="Duplicate"
      />

      {/* Step 2b: Delete Confirmation */}
      <ConfirmDialog
        open={activeDialog === 'delete-confirm'}
        onClose={() => setActiveDialog(null)}
        onConfirm={() => { deleteRecipe(recipe.id); setActiveDialog(null); }}
        title="Delete Recipe?"
        description="This action cannot be undone."
        variant="danger"
        confirmLabel="Delete"
      />
    </>
  );
}
```

---

## Dashboard Page

A dashboard with stat cards, charts, and activity timeline.

```tsx
function DashboardScreen() {
  return (
    <Page>
      <ScreenHeader title="Dashboard" subtitle="Your cooking overview" />

      <div className="px-3">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <StatCard
            label="Recipes Cooked"
            value={42}
            change="+8 this week"
            trend="up"
            sparklineData={[30, 35, 32, 38, 40, 42]}
          />
          <StatCard
            label="Total Time"
            value="18h"
            change="-2h vs last week"
            trend="down"
            sparklineData={[22, 20, 21, 19, 20, 18]}
          />
        </div>

        {/* Category Breakdown */}
        <SectionHeader title="By Category" />
        <Card className="mb-4">
          <PieChart
            data={[
              { label: 'Italian', value: 15 },
              { label: 'Asian', value: 12 },
              { label: 'Mexican', value: 8 },
              { label: 'Desserts', value: 7 },
            ]}
            donut
            centerLabel="42"
          />
        </Card>

        {/* Weekly Activity */}
        <SectionHeader title="This Week" />
        <Card className="mb-4">
          <BarChart
            data={[
              { label: 'Mon', value: 2 },
              { label: 'Tue', value: 3 },
              { label: 'Wed', value: 1 },
              { label: 'Thu', value: 4 },
              { label: 'Fri', value: 2 },
              { label: 'Sat', value: 5 },
              { label: 'Sun', value: 3 },
            ]}
            height={150}
          />
        </Card>

        {/* Recent Activity */}
        <SectionHeader title="Recent Activity" />
        <Timeline events={[
          { id: '1', title: 'Cooked Pasta Carbonara', timestamp: '2h ago', color: 'var(--color-positive)' },
          { id: '2', title: 'Added new recipe', subtitle: 'Thai Green Curry', timestamp: '5h ago' },
          { id: '3', title: 'Completed weekly goal', timestamp: 'Yesterday', color: 'var(--color-accent-warning)' },
        ]} />
      </div>
    </Page>
  );
}
```

---

## Chat Page

An AI chat interface with a copilot assistant.

```tsx
function CopilotScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      role: 'system',
      content: 'Kitchen AI is ready to help',
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await askAI(input);

      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.text,
        timestamp: Date.now(),
        thinking: response.thinking,
        toolCalls: response.toolCalls,
      };

      setMessages(prev => [...prev, assistantMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Page className="flex flex-col h-screen">
      <NavHeader title="Kitchen AI" />

      <ChatContainer
        className="flex-1"
        messages={messages}
        input={
          <ChatInput
            value={input}
            onChange={setInput}
            onSend={handleSend}
            disabled={isLoading}
            placeholder="Ask about recipes, techniques..."
          />
        }
      />
    </Page>
  );
}
```

### Advanced: Streaming Response

For streaming AI responses, update the last message's content progressively:

```tsx
const handleSendStreaming = async () => {
  const userMsg = { id: Date.now().toString(), role: 'user' as const, content: input };
  const assistantId = (Date.now() + 1).toString();
  const assistantMsg: ChatMessage = {
    id: assistantId,
    role: 'assistant',
    content: '',
    isStreaming: true,
    timestamp: Date.now(),
  };

  setMessages(prev => [...prev, userMsg, assistantMsg]);
  setInput('');

  for await (const chunk of streamAI(input)) {
    setMessages(prev =>
      prev.map(m =>
        m.id === assistantId
          ? { ...m, content: m.content + chunk }
          : m
      )
    );
  }

  // Mark streaming complete
  setMessages(prev =>
    prev.map(m =>
      m.id === assistantId
        ? { ...m, isStreaming: false }
        : m
    )
  );
};
```
