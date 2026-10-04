'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cva, type VariantProps } from 'class-variance-authority';
import { createContext, forwardRef, useContext, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '@/lib/cn';

type TabsVariant = 'segmented' | 'underline';
const TabsVariantContext = createContext<TabsVariant>('segmented');

export const Tabs = TabsPrimitive.Root;

const listVariants = cva('flex w-full items-center overflow-x-auto [scrollbar-width:none]', {
  variants: {
    variant: {
      segmented: 'gap-1 rounded-xl bg-muted p-1',
      underline: 'gap-4 border-b border-border',
    },
  },
  defaultVariants: { variant: 'segmented' },
});

export const TabsList = forwardRef<
  ElementRef<typeof TabsPrimitive.List>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.List> & VariantProps<typeof listVariants>
>(function TabsList({ className, variant, ...props }, ref) {
  const resolved = variant ?? 'segmented';
  return (
    <TabsVariantContext.Provider value={resolved}>
      <TabsPrimitive.List ref={ref} className={cn(listVariants({ variant: resolved }), className)} {...props} />
    </TabsVariantContext.Provider>
  );
});

const triggerVariants = cva(
  'inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap text-sm font-medium transition-[color,background-color,box-shadow] duration-fast ease-standard focus-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4',
  {
    variants: {
      variant: {
        segmented:
          'flex-1 rounded-lg px-3 text-muted-foreground hover:text-foreground data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm dark:data-[state=active]:bg-secondary-hover',
        underline:
          'relative -mb-px min-h-11 border-b-2 border-transparent px-1 text-muted-foreground hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground',
      },
    },
  },
);

export const TabsTrigger = forwardRef<
  ElementRef<typeof TabsPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(function TabsTrigger({ className, ...props }, ref) {
  const variant = useContext(TabsVariantContext);
  return <TabsPrimitive.Trigger ref={ref} className={cn(triggerVariants({ variant }), className)} {...props} />;
});

export const TabsContent = forwardRef<
  ElementRef<typeof TabsPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return <TabsPrimitive.Content ref={ref} className={cn('mt-4 focus-ring rounded-lg', className)} {...props} />;
});
