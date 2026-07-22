# Component Library Guide

All UI components are built on **Radix UI primitives** styled with **Tailwind CSS** via **class-variance-authority (CVA)**. Components live in `src/components/ui/` and are owned by the project — not installed from a third-party library.

Every component in `ui/` must satisfy all of the following before being used anywhere:
- [ ] 100% Vitest test coverage
- [ ] Zero axe violations
- [ ] Storybook story covering all variants and states

---

## Core Dependencies

```bash
pnpm add radix-ui class-variance-authority clsx tailwind-merge
```

```bash
pnpm add -D @storybook/nextjs @storybook/addon-a11y @storybook/addon-interactions
pnpm add -D @axe-core/playwright
```

Helper — merge Tailwind classes safely (add to `src/lib/utils.ts`):
```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

---

## Creating a New Component — Step by Step

### 1. Write the failing test first (TDD)

```ts
// tests/unit/components/ui/button.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '@/components/ui/button'

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
  })

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Click me</Button>)
    await userEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('is disabled when disabled prop is passed', () => {
    render(<Button disabled>Click me</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('renders the destructive variant', () => {
    render(<Button variant="destructive">Delete</Button>)
    expect(screen.getByRole('button')).toHaveClass('bg-destructive')
  })

  it('renders the sm size', () => {
    render(<Button size="sm">Small</Button>)
    expect(screen.getByRole('button')).toHaveClass('h-8')
  })
})
```

### 2. Implement the component

```tsx
// src/components/ui/button.tsx
import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { buttonVariants }
```

### 3. Write the Storybook story

```tsx
// stories/ui/button.stories.tsx
import type { Meta, StoryObj } from '@storybook/react'
import { Button } from '@/components/ui/button'

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'],
    },
    size: {
      control: 'select',
      options: ['default', 'sm', 'lg', 'icon'],
    },
  },
}

export default meta
type Story = StoryObj<typeof Button>

export const Default: Story = {
  args: { children: 'Button', variant: 'default', size: 'default' },
}

export const Destructive: Story = {
  args: { children: 'Delete', variant: 'destructive' },
}

export const Outline: Story = {
  args: { children: 'Cancel', variant: 'outline' },
}

export const Small: Story = {
  args: { children: 'Small', size: 'sm' },
}

export const Disabled: Story = {
  args: { children: 'Disabled', disabled: true },
}

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      {(['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'] as const).map(
        (variant) => (
          <Button key={variant} variant={variant}>
            {variant}
          </Button>
        ),
      )}
    </div>
  ),
}
```

### 4. Run checks

```bash
just test          # Vitest must pass at 100% coverage
just storybook     # Visually verify all stories
just e2e           # axe check runs here
```

---

## Accessibility — Decorative Elements

**Rule**: `aria-hidden="true"` does not suppress axe `color-contrast` violations. axe 4.11+ evaluates color contrast on all visible elements regardless of their ARIA semantics.

For decorative text (e.g. a large "404" code behind an error message):
- Increase opacity/contrast until the element passes WCAG AA (3:1 for large text, 4.5:1 for body text)
- Large text threshold: 18pt (24px) normal weight or 14pt (≈19px) bold — a `text-8xl font-bold` "404" qualifies as large text and needs 3:1

```tsx
// Wrong — aria-hidden does NOT suppress axe color-contrast
<p aria-hidden="true" className="text-8xl font-bold text-muted-foreground/30">404</p>

// Correct — opacity raised to achieve ≥ 3:1 against background
<p aria-hidden="true" className="text-8xl font-bold text-muted-foreground/60">404</p>
```

---

## Component Patterns

### Dialog (Radix)
```tsx
// src/components/ui/dialog.tsx
import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cn } from '@/lib/utils'

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-1.5', className)} {...props} />
)
const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold', className)}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

export { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogClose }
```

### Input (with label and error)
```tsx
// src/components/ui/input.tsx
import * as React from 'react'
import { cn } from '@/lib/utils'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'
```

### Form field wrapper (label + input + error)
```tsx
// src/components/ui/form-field.tsx
import { cn } from '@/lib/utils'

type FormFieldProps = {
  label: string
  htmlFor: string
  error?: string
  children: React.ReactNode
  className?: string
}

export function FormField({ label, htmlFor, error, children, className }: FormFieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium leading-none">
        {label}
      </label>
      {children}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
```

---

## Accessibility Checklist

Before any component ships, verify:

- [ ] Correct semantic HTML element used (`<button>` not `<div onClick>`)
- [ ] Focus is visible (never `outline: none` without a custom replacement)
- [ ] Interactive elements are keyboard-operable (Tab, Enter, Space, Escape, arrows as appropriate)
- [ ] ARIA labels on icon-only buttons (`aria-label`)
- [ ] Form inputs have associated `<label>` (via `htmlFor` / `id`)
- [ ] Error messages use `role="alert"` so they're announced by screen readers
- [ ] Color is never the sole means of conveying information
- [ ] Contrast ratio ≥ 4.5:1 for normal text, ≥ 3:1 for large text
- [ ] Radix handles ARIA roles, states (`aria-expanded`, `aria-selected`, etc.) — do not override unless necessary
- [ ] `axe-core` reports zero violations in Playwright E2E

---

## CVA Variant Reference

```ts
const componentVariants = cva(
  'base-classes-always-applied',
  {
    variants: {
      variant: {
        default: 'classes-for-default',
        secondary: 'classes-for-secondary',
      },
      size: {
        sm: 'classes-for-sm',
        md: 'classes-for-md',
        lg: 'classes-for-lg',
      },
    },
    compoundVariants: [
      // Applied when multiple variant conditions are met simultaneously
      { variant: 'default', size: 'sm', class: 'extra-classes' },
    ],
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  },
)

// Export the type for consumers
export type ComponentVariants = VariantProps<typeof componentVariants>
```

---

## Storybook Configuration

```ts
// .storybook/main.ts
import type { StorybookConfig } from '@storybook/nextjs'

const config: StorybookConfig = {
  stories: ['../stories/**/*.stories.@(ts|tsx)'],
  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-a11y',       // axe-core integration
    '@storybook/addon-interactions',
  ],
  framework: { name: '@storybook/nextjs', options: {} },
}

export default config
```

```ts
// .storybook/preview.ts
import type { Preview } from '@storybook/react'
import '../src/app/globals.css'

const preview: Preview = {
  parameters: {
    a11y: { config: { rules: [{ id: 'color-contrast', enabled: true }] } },
    backgrounds: { default: 'dark' },
  },
}

export default preview
```

---

## Component Naming Conventions

| Type | Location | Example |
|---|---|---|
| Radix primitive wrapper | `src/components/ui/` | `button.tsx`, `dialog.tsx` |
| Composed feature component | `src/components/[feature]/` | `user-card.tsx`, `nav-menu.tsx` |
| Route-specific component | `src/app/[route]/` | co-located with its page |
| Story | `stories/ui/` | `button.stories.tsx` |
| Test | `tests/unit/components/ui/` | `button.test.tsx` |

File names: **kebab-case** for files, **PascalCase** for exported components.
